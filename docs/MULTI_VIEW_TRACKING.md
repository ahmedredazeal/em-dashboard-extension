# Multi-View Sentry Tracking

_Introduced in v1.8.0_

The Sentry trend chart can track **multiple Sentry views at once**, drawing each as its
own colored line on a single shared chart. Previously only one view could be tracked.

## Data model

```
settings.sentry.trackedViewIds : string[]   // e.g. ["201661", "205219"]
```

Replaces the old single `settings.sentry.trackedViewId` (string). A migration
(`v1_8_0_multi_view_tracking` in `src/migrations.js`) wraps any existing single value
into a one-element array, so existing tracking is preserved on upgrade. The old key is
left untouched for one version as a rollback safety net; background/popup code reads
`trackedViewIds` first and falls back to the legacy key if the array is absent.

## Colors

Defined in `src/trend-colors.js` and shared by the settings swatches, the chart lines,
and the legend so a given view is always the same color.

| Slot | Hex       |
|------|-----------|
| 0    | `#6366f1` indigo |
| 1    | `#22c55e` green  |
| 2    | `#f59e0b` amber  |
| 3    | `#ec4899` pink   |
| 4    | `#06b6d4` cyan   |
| 5    | `#a855f7` purple |
| 6    | `#ef4444` red    |
| 7    | `#14b8a6` teal   |

Color is assigned by the view's **index in `settings.sentry.views`** (its position in
the Settings list), via `colorForIndex(index)`. Past 8 views the palette cycles.

## Storage (unchanged)

Samples are still stored per view in `chrome.storage.sync`:

```
sentryTrend:{viewId}:{YYYY-MM}  →  { viewId, yearMonth, samples:[{day, count}] }
```

The keys already namespace by `viewId`, so multiple tracked views never collide.

## Recording

`background.js` records a daily sample for **every** view in `trackedViewIds` on each
fetch (it previously recorded only the single tracked view). Each view writes to its own
storage key.

## Chart

`buildMultiTrendCardHTML(series)` in `popup.js`:

- **Shared X axis** — the union of all tracked views' date ranges. A view with a shorter
  history simply starts its line later on the axis.
- **Shared Y axis** — `max` count across all visible views, plus ~15% padding.
- **One polyline per view**, broken at gaps (no fake line drawn across missing days).
- **Gap shading** (grey "no data · Nd" rectangles) is only drawn when a **single** line is
  visible, to keep multi-line charts readable.
- **Legend** — one entry per tracked view: color swatch, label, latest count, day-over-day
  delta. **Click an entry to hide/show that line** (`_hiddenTrendViews` Set; re-renders).

## Export

Clicking ⬇ opens a dropdown:

```
Export
 ├─ <View A>              → A.json + A's PDF
 ├─ <View B>              → B.json + B's PDF
 ├─ …
 └─ All views (separate)  → one .json per view (batch) + combined multi-line PDF
```

- **Per view** → downloads that view's JSON + opens a single-view PDF page.
- **All views** → downloads one JSON file **per view** (staggered ~350 ms so the browser
  doesn't drop rapid downloads) + opens **one combined** multi-line PDF.

Every JSON file is strictly one view (`{ version, exportedAt, viewId, viewLabel, samples }`)
so any export remains independently importable.

The print page (`print.html` / `print.js`) accepts a v2 payload:

```json
{ "version":"2", "mode":"single|multi", "series":[{ "viewId","viewLabel","color","samples" }] }
```

and still understands the legacy single-view `{ viewId, viewLabel, samples }` shape.

## Import

`importTrendSamples(viewId, samples)` is unchanged — the file carries its own `viewId`, so
import auto-routes to the correct view. Live readings still win (a day already recorded by
the extension is never overwritten by an import).

**Decision #3:** if the imported file's `viewId` is **not** currently tracked, the import
still happens silently (data is stored), and a non-blocking amber notice appears in Settings
telling the user to click **Track** on that view if they want it on the chart.

## Untracking (Decision #2)

Clicking **Track** to untrack a view removes it from `trackedViewIds` only. Its historical
samples in `chrome.storage.sync` are **kept** — re-tracking restores the full line.

## Scenarios reference

| Scenario | Behavior |
|---|---|
| 1 view tracked | Single line; export dropdown shows 1 entry (Decision #1). |
| 4 views tracked | 4 colored lines + legend. |
| Different start dates | X spans the union; each line draws only where it has data. |
| Same count, same day | Lines overlap; color distinguishes them. |
| Import tracked view | Merges in; live readings win. |
| Import non-tracked view | Silent import + amber Settings warning (Decision #3). |
| Legacy export file | Still imports (format unchanged). |
| Untrack a view | History kept; re-track restores the line (Decision #2). |
| > 8 views | Palette cycles. |
| Hide a line | Click its legend entry; click again to show. |
