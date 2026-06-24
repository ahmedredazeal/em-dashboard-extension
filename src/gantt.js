/**
 * src/gantt.js — Zealer Dashboard
 *
 * Sprint Gantt — matches Sprint Planner's exact HTML layout.
 * Source: sprint-planner-extension/gantt-print.js (EM mode)
 *         zealer-dashboard-extension (deprecated, engineer mode)
 *
 * Layout (div-based, NOT SVG):
 *   ┌──────────────┬──────────────────────────────────────────┐
 *   │  Left col    │  Timeline (position:absolute, % coords)  │
 *   │  168px fixed │  bars coloured by assignee (PAL)         │
 *   └──────────────┴──────────────────────────────────────────┘
 *
 * Row order: priority (Highest→Lowest) then Jira rank (lexorank asc).
 * Bars span: startDate (set by Sprint Planner) → dueDate.
 * Tickets without dueDate shown at bottom with a dashed placeholder.
 * Click on any ticket (bar or label): opens Jira issue in new tab.
 * Engineer mode: filterMine=true shows only the engineer's own tickets.
 */

import { priorityBg, priorityFg, priorityIndex } from './domain-constants.js';

// ── Assignee colour palette (Sprint Planner PAL) ──────────────────────────
const PAL = [
  { bg:'#B5D4F4', bo:'#378ADD', tx:'#0C447C' },
  { bg:'#C0DD97', bo:'#639922', tx:'#27500A' },
  { bg:'#FAC775', bo:'#BA7517', tx:'#633806' },
  { bg:'#F4C0D1', bo:'#D4537E', tx:'#72243E' },
  { bg:'#CECBF6', bo:'#7F77DD', tx:'#3C3489' },
  { bg:'#9FE1CB', bo:'#1D9E75', tx:'#085041' },
  { bg:'#F5C4B3', bo:'#D85A30', tx:'#712B13' },
  { bg:'#D3D1C7', bo:'#888780', tx:'#444441' },
];
let _aC = {}, _aI = 0;
function resetColors()   { _aC = {}; _aI = 0; }
function gc(name) {
  if (!name) return { bg:'#D3D1C7', bo:'#888780', tx:'#444441' };
  if (!_aC[name]) { _aC[name] = PAL[_aI % PAL.length]; _aI++; }
  return _aC[name];
}

// ── Priority colours (from the shared domain-constants single source) ───────

// ── Helpers ────────────────────────────────────────────────────────────────
function esc(v) {
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day:'numeric', month:'short' });
}

/**
 * Ordered working-day date strings between start and end (inclusive).
 */
export function getWorkingDays(startISO, endISO, workingDays = [0,1,2,3,4]) {
  const set = new Set(workingDays);
  const result = [];
  const cur = new Date(startISO); cur.setUTCHours(0,0,0,0);
  const end = new Date(endISO);   end.setUTCHours(23,59,59,999);
  while (cur <= end) {
    if (set.has(cur.getUTCDay())) result.push(cur.toISOString().slice(0,10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return result;
}

/** Column index (0-based) for a date; clamps to valid range. */
export function dayColIndex(dateISO, workingDayList) {
  const exact = workingDayList.indexOf(dateISO);
  if (exact >= 0) return exact;
  if (dateISO <= workingDayList[0]) return 0;
  if (dateISO >= workingDayList[workingDayList.length - 1]) return workingDayList.length - 1;
  let lo = 0, hi = workingDayList.length - 1;
  while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (workingDayList[mid] <= dateISO) lo = mid; else hi = mid; }
  return lo;
}

/** Format ISO date as "23 May" */
export function fmtDay(iso) { return fmtDate(iso); }

// ── Subtask phase scheduling ─────────────────────────────────────────────────
// Subtasks are laid out by phase so a parent row reads as a plan, not a pile of
// parallel bars: implementation → code review (sequential within a function),
// each function (BE/FE/POS) on its own lane in parallel, QA on one lane AFTER all
// function work. Bar WIDTH = effort (estimate hours → days), POSITION = queue
// order within the lane, anchored to the row's earliest start so real dates are
// still respected. Presentation only — NOT a capacity/ceremony scheduler.
const GANTT_HOURS_PER_DAY   = 6;
const GANTT_MIN_DUR_DAYS    = 0.25;   // floor so a tiny estimate still draws + sequences
const GANTT_DEFAULT_PHASE_H = { impl: 6, review: 3, qa: 4 }; // unestimated fallback

/**
 * Function prefix from a summary. Accepts bracketed "[BE] …" OR a bare leading
 * "BE …" (case-insensitive), restricted to the team's set BE/FE/POS so an
 * ordinary summary word is not mistaken for a function. Returns "" if none.
 */
export function getFunctionPrefix(summary = '') {
  const m = String(summary).match(/^\s*\[?\s*(BE|FE|POS)\s*\]?\b/i);
  return m ? m[1].toUpperCase() : '';
}

/** Phase of a subtask from its summary: 'qa' | 'review' | 'impl'. */
export function detectPhase(summary = '') {
  const s = String(summary).toLowerCase();
  // QA: bracketed [QA] / leading qa / the word qa anywhere
  if (/^\s*\[?\s*qa\s*\]?\b/.test(s) || /\bqa\b/.test(s)) return 'qa';
  // Review: "review" or the shorthand "cr"
  if (/\breview\b|\bcr\b/.test(s)) return 'review';
  return 'impl';
}

/**
 * Lay a parent's children out into phase-sequenced lanes.
 * @returns {{ bars: {child,lane,leftPct,widthPct,phase}[], nLanes: number }}
 *   Function lanes (BE/FE/POS…) run in parallel, each ordered impl → review.
 *   QA shares one lane that starts after the latest function-lane work.
 */
export function scheduleChildren(children = [], sprint = {}, wdays = [], nDays = 1) {
  const PHASE_RANK = { impl: 0, review: 1, qa: 2 };
  const FN_PREF    = ['BE', 'FE', 'POS'];

  const enriched = children.map(c => ({
    c, phase: detectPhase(c.summary), fn: getFunctionPrefix(c.summary) || '—',
  }));

  const fnGroups = new Map();
  const qa = [];
  for (const e of enriched) {
    if (e.phase === 'qa') qa.push(e);
    else { if (!fnGroups.has(e.fn)) fnGroups.set(e.fn, []); fnGroups.get(e.fn).push(e); }
  }
  const fnNames = [...fnGroups.keys()].sort((a, b) => {
    const ia = FN_PREF.indexOf(a), ib = FN_PREF.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });

  const startIdxOf = (c) => {
    const eff = (c.startDate && sprint.startDate && c.startDate >= sprint.startDate)
      ? c.startDate : sprint.startDate;
    return Math.max(0, dayColIndex(eff || sprint.startDate, wdays));
  };
  const rowStart = enriched.length ? Math.min(...enriched.map(e => startIdxOf(e.c))) : 0;
  const durDaysOf = (c, phase) => {
    const h = (c.estimateHours != null && c.estimateHours > 0) ? c.estimateHours : GANTT_DEFAULT_PHASE_H[phase];
    return Math.max(h / GANTT_HOURS_PER_DAY, GANTT_MIN_DUR_DAYS);
  };
  const pct = (units) => Math.max(0, (units / (nDays || 1)) * 100);

  const bars = [];
  let lane = 0, maxFnEnd = rowStart;
  for (const fn of fnNames) {
    const items = fnGroups.get(fn).sort((a, b) =>
      (PHASE_RANK[a.phase] - PHASE_RANK[b.phase]) ||
      String(a.c.rank || '').localeCompare(String(b.c.rank || '')));
    let cursor = rowStart;
    for (const e of items) {
      const dur = durDaysOf(e.c, e.phase);
      bars.push({ child: e.c, lane, leftPct: Math.min(pct(cursor), 100), widthPct: pct(dur), phase: e.phase });
      cursor += dur;
    }
    maxFnEnd = Math.max(maxFnEnd, cursor);
    lane++;
  }
  if (qa.length) {
    const items = qa.sort((a, b) => String(a.c.rank || '').localeCompare(String(b.c.rank || '')));
    let cursor = maxFnEnd;
    for (const e of items) {
      const dur = durDaysOf(e.c, 'qa');
      bars.push({ child: e.c, lane, leftPct: Math.min(pct(cursor), 100), widthPct: pct(dur), phase: 'qa' });
      cursor += dur;
    }
    lane++;
  }
  return { bars, nLanes: Math.max(1, lane) };
}


// ── Story partitioning ─────────────────────────────────────────────────────
const priIdx = priorityIndex; // shared from domain-constants

/**
 * Sort stories by priority then Jira rank (lexorank asc), then split into
 * scheduled (have dueDate) and unscheduled (no dueDate).
 * Engineer mode: filterMine restricts to the engineer's own tickets.
 */
export function partitionStories(stories, accountId, filterMine = false) {
  const list = filterMine && accountId
    ? stories.filter(s => s.assigneeAccountId === accountId)
    : stories;

  // Primary: priority; secondary: rank (lexorank — lower string = higher rank)
  const sorted = [...list].sort((a, b) => {
    const pd = priIdx(a.priority) - priIdx(b.priority);
    if (pd !== 0) return pd;
    if (a.rank && b.rank) return a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0;
    if (a.rank) return -1;
    if (b.rank) return 1;
    return a.key < b.key ? -1 : 1;
  });

  return {
    scheduled:   sorted.filter(s => s.dueDate),
    unscheduled: sorted.filter(s => !s.dueDate),
  };
}

/**
 * Attach child subtasks to their parent stories and synthesize parent rows for
 * orphan subtasks (whose parent isn't in the sprint story list).
 *
 * Returns a NEW array of "row stories": each is the parent story object with a
 * `.children` array. The Gantt renders one row per element here, with the
 * children laid out as per-assignee sub-lanes inside the row.
 *
 * @param {Object[]} stories   — parent stories (no subtasks)
 * @param {Object[]} subtasks  — subtask stories (have parentKey)
 * @param {string}   accountId — engineer accountId (for filterMine on children)
 * @param {boolean}  filterMine
 */
export function attachChildren(stories, subtasks = [], accountId = '', filterMine = false) {
  const byParent = new Map();
  for (const sub of subtasks) {
    const pk = sub.parentKey || '__noparent__';
    if (!byParent.has(pk)) byParent.set(pk, []);
    byParent.get(pk).push(sub);
  }

  const storyKeys = new Set(stories.map(s => s.key));
  const rows = stories.map(s => ({ ...s, children: (byParent.get(s.key) || []) }));

  // Orphan subtasks: parent not present in the sprint's story list → make a
  // synthetic parent row so the work still shows (label = the parent key).
  for (const [pk, subs] of byParent.entries()) {
    if (pk === '__noparent__' || storyKeys.has(pk)) continue;
    // Synthesize a minimal parent from the first child's parent reference.
    const child0 = subs[0];
    rows.push({
      key: pk,
      summary: child0.parentSummary || `Parent ${pk}`,
      priority: child0.priority || 'Medium',
      rank: child0.rank || null,
      assignee: null, assigneeAccountId: null,
      // Parent due date = latest child due date (so the dashed marker lands sensibly)
      dueDate: subs.map(c => c.dueDate).filter(Boolean).sort().pop() || null,
      startDate: subs.map(c => c.startDate).filter(Boolean).sort()[0] || null,
      points: 0, isSynthetic: true,
      children: subs,
    });
  }

  // In engineer "mine" mode, keep a parent row if the parent OR any child is mine.
  if (filterMine && accountId) {
    return rows.filter(r =>
      r.assigneeAccountId === accountId ||
      (r.children || []).some(c => c.assigneeAccountId === accountId)
    ).map(r => ({
      ...r,
      // also narrow the visible children to mine
      children: (r.children || []).filter(c => c.assigneeAccountId === accountId),
    }));
  }

  return rows;
}

// ── Main renderer ──────────────────────────────────────────────────────────
/**
 * Build the Gantt HTML — Sprint Planner visual style (HTML divs, not SVG).
 *
 * @param {Object[]} stories      — normalizeStory array (needs startDate, dueDate, rank)
 * @param {Object}   sprint       — { name, startDate, endDate }
 * @param {number[]} workingDays  — [0..6] Sun=0
 * @param {string}   accountId    — engineer's accountId (used for filterMine + row highlight)
 * @param {Object}   [opts]
 * @param {boolean}  [opts.filterMine=false]
 * @param {number}   [opts.labelWidth=168]
 * @param {number}   [opts.barH=17]
 * @param {number}   [opts.rowH=44]
 * @param {string}   [opts.minWidth='320px']
 * @returns {string} HTML markup string
 */
export function buildGanttSVG(stories, sprint, workingDays = [0,1,2,3,4], accountId = '', opts = {}) {
  const {
    filterMine  = false,
    labelWidth  = 168,
    barH        = 17,
    rowH        = 44,
    laneH       = 22,   // height of one assignee sub-lane within a parent row
    minWidth    = '320px',
    subtasks    = [],
  } = opts;

  if (!sprint?.startDate || !sprint?.endDate) return '<div style="font-size:12px;color:var(--text-muted);padding:8px 0;">No sprint date range.</div>';

  resetColors();

  const wdays    = getWorkingDays(sprint.startDate, sprint.endDate, workingDays);
  const nDays    = wdays.length || 1;
  const todayISO = new Date().toISOString().slice(0, 10);
  const WD       = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  // Percentage coordinate system — each working day gets an equal share
  const DW = {}, DO = {};
  let cum = 0;
  wdays.forEach(d => { DW[d] = 100 / nDays; DO[d] = cum; cum += DW[d]; });

  // Nest subtasks into their parents, then sort+split parents by due date.
  const rowsWithChildren = attachChildren(stories, subtasks, accountId, filterMine);
  const { scheduled, unscheduled } = partitionStories(rowsWithChildren, accountId, false);
  // Re-attach children after partition (partitionStories spreads but keeps props)
  const hasUnscheduled = unscheduled.length > 0;

  // ── Day header ────────────────────────────────────────────────────────────
  let hdrs = '';
  wdays.forEach((d, i) => {
    const dtDow   = new Date(d + 'T00:00:00').getDay();
    const isToday = d === todayISO;
    const col     = isToday ? '#DC2626' : '#6B7280';
    const w       = DW[d];
    const lbl     = `${WD[dtDow]} ${parseInt(d.slice(8))}`;
    hdrs += `<div style="flex:0 0 ${w.toFixed(3)}%;text-align:center;font-size:9px;`
          + `padding:5px 0;color:${col};font-weight:${isToday ? '700' : '400'};`
          + `border-left:${i ? '1px solid var(--border,rgba(255,255,255,.08))' : 'none'};`
          + `white-space:nowrap;overflow:hidden;">${esc(lbl)}</div>`;
  });

  let html = `<div style="min-width:${minWidth};">`;

  // Header row
  html += `<div style="display:flex;background:var(--surface-raised,rgba(255,255,255,.04));`
        + `border-bottom:1px solid var(--border,rgba(255,255,255,.08));">`;
  html += `<div style="flex:0 0 ${labelWidth}px;padding:6px 10px;font-size:10px;`
        + `font-weight:600;color:var(--text-muted,#94a3b8);`
        + `border-right:1px solid var(--border,rgba(255,255,255,.08));">Story</div>`;
  html += `<div style="flex:1;display:flex;">${hdrs}</div></div>`;

  // ── Story row renderer ─────────────────────────────────────────────────
  // Parent acts as the row label/container. Its due date is a dashed vertical
  // marker. Child subtasks render as bars in per-assignee sub-lanes (Sprint
  // Planner layout). A childless parent renders its own single bar.
  function storyRow(story, isUnscheduled = false) {
    const isMe  = story.assigneeAccountId === accountId;
    const isOv  = story.dueDate && story.dueDate < todayISO;
    const isTD  = story.dueDate === todayISO;
    const children = story.children || [];

    // Sub-lanes: one per distinct child assignee (fallback to a single lane
    // when the parent has no children — it draws its own bar instead).
    // Phase-sequenced layout (impl → review per function, QA after) drives the
    // lanes now, instead of one-lane-per-assignee. Bars stay assignee-coloured.
    const schedule = children.length > 0
      ? scheduleChildren(children, sprint, wdays, nDays)
      : { bars: [], nLanes: 1 };
    const nLanes = Math.max(1, schedule.nLanes);
    const dynRowH = children.length > 0
      ? Math.max(rowH, nLanes * laneH + 10)
      : rowH;

    let rowBg = '';
    if (isTD)       rowBg = 'background:rgba(220,38,38,0.06);';
    else if (isOv)  rowBg = 'background:rgba(220,38,38,0.04);';
    else if (isMe)  rowBg = 'background:rgba(99,102,241,0.04);';

    const pText = (story.priority || 'Medium').slice(0, 4);
    const pBg   = priorityBg(story.priority);
    const pFg   = priorityFg(story.priority);
    const dueDateColor = (isTD || isOv) ? '#DC2626' : '#16A34A';

    let duePct = -1;
    if (!isUnscheduled && story.dueDate && DO[story.dueDate] !== undefined) {
      duePct = DO[story.dueDate] + DW[story.dueDate];
    }

    html += `<div data-jira-key="${esc(story.key)}" style="display:flex;min-height:${dynRowH}px;`
          + `border-bottom:1px solid var(--border,rgba(255,255,255,.07));${rowBg}cursor:pointer;" `
          + `title="Open ${esc(story.key)} in Jira">`;

    // Label cell
    html += `<div style="flex:0 0 ${labelWidth}px;padding:5px 10px;`
          + `border-right:1px solid var(--border,rgba(255,255,255,.08));`
          + `display:flex;flex-direction:column;justify-content:center;overflow:hidden;">`;
    html += `<div style="display:flex;align-items:center;gap:4px;margin-bottom:2px;flex-wrap:wrap;">`;
    html += `<span style="font-size:9px;color:var(--text-muted,#94a3b8);font-family:monospace;">${esc(story.key)}</span>`;
    html += `<span style="font-size:9px;padding:1px 4px;border-radius:3px;font-weight:500;background:${pBg};color:${pFg};">${esc(pText)}</span>`;
    if (children.length > 0) html += `<span style="font-size:9px;padding:1px 4px;border-radius:3px;background:rgba(148,163,184,0.15);color:var(--text-muted,#94a3b8);font-weight:500;" title="${children.length} child ticket${children.length>1?'s':''}">${children.length}↳</span>`;
    if (story.isSynthetic) html += `<span style="font-size:9px;color:var(--text-muted,#94a3b8);font-style:italic;" title="Parent not in this sprint">ext</span>`;
    if (isUnscheduled) html += `<span style="font-size:9px;padding:1px 4px;border-radius:3px;background:rgba(249,115,22,0.15);color:#f97316;font-weight:500;">⚠ No date</span>`;
    if (isTD) html += `<span style="font-size:9px;color:#DC2626;" title="Due today">🔴</span>`;
    html += `</div>`;
    html += `<div style="font-size:11px;color:var(--text,#e2e8f0);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(story.summary)}">${esc(story.summary)}</div>`;
    if (!isUnscheduled && story.dueDate) {
      html += `<div style="font-size:10px;margin-top:1px;color:${dueDateColor};">→ ${esc(fmtDate(story.dueDate))}</div>`;
    } else if (isUnscheduled) {
      html += `<div style="font-size:10px;margin-top:1px;color:#f97316;font-style:italic;">Add due date in Jira</div>`;
    }
    html += `</div>`;

    // Timeline cell
    html += `<div style="flex:1;position:relative;min-width:0;overflow:hidden;">`;

    // Grid + today highlight
    wdays.forEach((d, i) => {
      if (i > 0) {
        html += `<div style="position:absolute;left:${DO[d].toFixed(3)}%;top:0;bottom:0;border-left:1px solid var(--border,rgba(255,255,255,.06));z-index:1;pointer-events:none;"></div>`;
      }
      if (d === todayISO) {
        html += `<div style="position:absolute;left:${DO[d].toFixed(3)}%;width:${DW[d].toFixed(3)}%;top:0;bottom:0;background:rgba(220,38,38,0.07);z-index:0;pointer-events:none;"></div>`;
      }
    });

    // Parent due-date dashed marker (Sprint Planner style)
    if (duePct > 0 && duePct <= 100) {
      html += `<div style="position:absolute;left:${Math.min(duePct,99.5).toFixed(3)}%;top:0;bottom:0;border-left:1.5px dashed #9ca3af;z-index:5;pointer-events:none;" title="Due ${esc(fmtDate(story.dueDate))}"></div>`;
    }

    // Helper: place a single bar from a ticket's start/due on a given lane top.
    const barFor = (t, top, isChild) => {
      if (!t.dueDate) return '';
      const c = gc(t.assignee || t.key);
      const effStart = (t.startDate && t.startDate >= sprint.startDate) ? t.startDate : sprint.startDate;
      const startCol = wdays[Math.max(0, dayColIndex(effStart, wdays))];
      const dueCol   = wdays[Math.min(wdays.length - 1, dayColIndex(t.dueDate, wdays))];
      const left  = DO[startCol] ?? 0;
      const right = (DO[dueCol] ?? 0) + (DW[dueCol] ?? 0);
      const w     = Math.max(right - left, 0.5);
      const subMark = isChild ? '↳ ' : '';
      // Rich tooltip: "Summary · Assignee · Npt · Status" (estimate = story
      // points; omitted when 0, common for subtasks). Children get their OWN
      // pointer events + data-jira-key so the hover shows THIS tooltip (not the
      // row's "Open parent" title) and a click opens the child issue in Jira.
      const estPart = t.points > 0 ? ` · ${t.points}pt` : '';
      const statusPart = t.status ? ` · ${esc(t.status)}` : '';
      const tip = `${esc(t.summary)} · ${esc(t.assignee || 'Unassigned')}${estPart}${statusPart}`;
      const childAttrs = isChild
        ? `data-jira-key="${esc(t.key)}" style="pointer-events:auto;cursor:pointer;`
        : `style="pointer-events:none;`;
      return `<div title="${tip}" ${childAttrs}`
        + `position:absolute;left:${left.toFixed(3)}%;width:calc(${w.toFixed(3)}% - 1px);min-width:18px;`
        + `top:${top}px;height:${barH}px;background:${c.bg};border:0.5px solid ${c.bo};border-radius:3px;z-index:4;`
        + `display:flex;align-items:center;overflow:hidden;">`
        + `<span style="font-size:10px;padding:0 4px;color:${c.tx};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;">${subMark}${esc(t.summary)}</span>`
        + `</div>`;
    };

    if (children.length > 0) {
      // Phase-sequenced lanes: each bar positioned by the schedule (leftPct/
      // widthPct = queue order + effort), coloured by assignee, labelled by phase.
      const phaseLabel = { impl: '', review: 'review · ', qa: 'QA · ' };
      schedule.bars.forEach(b => {
        const t = b.child;
        const top = 5 + b.lane * laneH;
        const c = gc(t.assignee || t.key);
        const left = Math.min(b.leftPct, 99.5);
        const w = Math.max(b.widthPct, 0.5);
        const estPart = (t.estimateHours > 0) ? ` · ${t.estimateHours}h` : (t.points > 0 ? ` · ${t.points}pt` : '');
        const statusPart = t.status ? ` · ${esc(t.status)}` : '';
        const fnPart = getFunctionPrefix(t.summary);
        const tip = `${esc(t.summary)} · ${esc(t.assignee || 'Unassigned')}${estPart}${statusPart} · ${b.phase}`;
        html += `<div title="${tip}" data-jira-key="${esc(t.key)}" style="pointer-events:auto;cursor:pointer;`
          + `position:absolute;left:${left.toFixed(3)}%;width:calc(${w.toFixed(3)}% - 1px);min-width:18px;`
          + `top:${top}px;height:${barH}px;background:${c.bg};border:0.5px solid ${c.bo};border-radius:3px;z-index:4;`
          + `display:flex;align-items:center;overflow:hidden;${b.phase === 'qa' ? 'border-style:dashed;' : ''}">`
          + `<span style="font-size:10px;padding:0 4px;color:${c.tx};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;">↳ ${phaseLabel[b.phase] || ''}${esc(t.summary)}</span>`
          + `</div>`;
      });
    } else if (!isUnscheduled && story.dueDate) {
      // Childless parent: draw its own single bar.
      const barTop = Math.round((dynRowH - barH) / 2);
      html += barFor(story, barTop, false);
      if (story.points > 0) {
        const dueCol = wdays[Math.min(wdays.length - 1, dayColIndex(story.dueDate, wdays))];
        const barRight = (DO[dueCol] ?? 0) + (DW[dueCol] ?? 0);
        html += `<div style="position:absolute;right:calc(${(100 - barRight).toFixed(3)}% + 3px);top:${barTop}px;font-size:8px;color:var(--text-muted,#94a3b8);opacity:0.8;z-index:4;pointer-events:none;line-height:${barH}px;">${story.points}pt</div>`;
      }
    } else if (isUnscheduled) {
      const barTop = Math.round((dynRowH - barH) / 2);
      html += `<div style="position:absolute;left:0;right:0;top:${barTop}px;height:${barH}px;border:1px dashed rgba(249,115,22,0.4);border-radius:3px;z-index:3;display:flex;align-items:center;overflow:hidden;pointer-events:none;">`;
      html += `<span style="font-size:9px;padding:0 6px;color:rgba(249,115,22,0.6);white-space:nowrap;">no due date — add in Jira</span>`;
      html += `</div>`;
    }

    html += `</div></div>`;
  }

  scheduled.forEach(s => storyRow(s, false));

  if (hasUnscheduled) {
    html += `<div style="display:flex;min-height:28px;align-items:center;background:rgba(249,115,22,0.06);border-bottom:1px solid rgba(249,115,22,0.2);border-top:1px solid rgba(249,115,22,0.2);">`;
    html += `<div style="flex:0 0 ${labelWidth}px;padding:4px 10px;font-size:10px;font-weight:600;color:#f97316;border-right:1px solid rgba(249,115,22,0.2);">⚠ ${unscheduled.length} ticket${unscheduled.length>1?'s':''} without due dates</div>`;
    html += `<div style="flex:1;padding:4px 10px;font-size:10px;color:rgba(249,115,22,0.7);">These tickets are not placed on the timeline. Add due dates in Jira.</div>`;
    html += `</div>`;
    unscheduled.forEach(s => storyRow(s, true));
  }

  // Legend
  const assignees = Object.keys(_aC);
  if (assignees.length > 0) {
    html += `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border,rgba(255,255,255,.08));display:flex;flex-wrap:wrap;gap:6px;align-items:center;">`;
    html += `<span style="font-size:11px;color:var(--text-muted,#94a3b8);font-weight:600;">Team:&nbsp;</span>`;
    assignees.forEach(name => {
      const c = gc(name);
      html += `<span style="font-size:11px;padding:2px 10px;background:${c.bg};border:1px solid ${c.bo};color:${c.tx};border-radius:10px;font-weight:500;">${esc(name)}</span>`;
    });
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}
