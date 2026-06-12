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

// ── Priority colours ───────────────────────────────────────────────────────
function priorityBg(p) {
  const m = { urgent:'#FEE2E2',highest:'#FEE2E2',critical:'#FEE2E2',high:'#FEF3C7',medium:'#FEF9C3',low:'#DBEAFE',lowest:'#F3F4F6' };
  return m[(p||'medium').toLowerCase()] || '#FEF9C3';
}
function priorityFg(p) {
  const m = { urgent:'#991B1B',highest:'#991B1B',critical:'#991B1B',high:'#92400E',medium:'#854D0E',low:'#1E40AF',lowest:'#374151' };
  return m[(p||'medium').toLowerCase()] || '#854D0E';
}

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

// ── Story partitioning ─────────────────────────────────────────────────────
const PORD = { urgent:0, highest:0, critical:0, high:1, medium:2, low:3, lowest:4 };
const priIdx = p => PORD[(p||'medium').toLowerCase()] ?? 2;

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
    minWidth    = '320px',
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

  const { scheduled, unscheduled } = partitionStories(stories, accountId, filterMine);
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
  function storyRow(story, isUnscheduled = false) {
    const isMe  = story.assigneeAccountId === accountId;
    const isOv  = story.dueDate && story.dueDate < todayISO;
    const isTD  = story.dueDate === todayISO;
    const c     = gc(story.assignee || story.key);

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

    html += `<div data-jira-key="${esc(story.key)}" style="display:flex;min-height:${rowH}px;`
          + `border-bottom:1px solid var(--border,rgba(255,255,255,.07));${rowBg}cursor:pointer;" `
          + `title="Open ${esc(story.key)} in Jira">`;

    // Label cell
    html += `<div style="flex:0 0 ${labelWidth}px;padding:5px 10px;`
          + `border-right:1px solid var(--border,rgba(255,255,255,.08));`
          + `display:flex;flex-direction:column;justify-content:center;overflow:hidden;">`;
    html += `<div style="display:flex;align-items:center;gap:4px;margin-bottom:2px;flex-wrap:wrap;">`;
    const subMark = story.isSubtask ? `<span title="Subtask${story.parentKey ? ' of ' + esc(story.parentKey) : ''}" style="color:var(--text-muted,#94a3b8);">↳ </span>` : '';
    html += `<span style="font-size:9px;color:var(--text-muted,#94a3b8);font-family:monospace;">${subMark}${esc(story.key)}</span>`;
    html += `<span style="font-size:9px;padding:1px 4px;border-radius:3px;font-weight:500;background:${pBg};color:${pFg};">${esc(pText)}</span>`;
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

    // Due-date dashed marker
    if (duePct > 0 && duePct <= 100) {
      html += `<div style="position:absolute;left:${Math.min(duePct,99.5).toFixed(3)}%;top:0;bottom:0;border-left:1.5px dashed #9ca3af;z-index:5;pointer-events:none;"></div>`;
    }

    if (!isUnscheduled && story.dueDate) {
      const effectiveStart = (story.startDate && story.startDate >= sprint.startDate)
        ? story.startDate : sprint.startDate;
      const startColDate = wdays[Math.max(0, dayColIndex(effectiveStart, wdays))];
      const dueColDate   = wdays[Math.min(wdays.length - 1, dayColIndex(story.dueDate, wdays))];
      const barLeft  = DO[startColDate] ?? 0;
      const barRight = (DO[dueColDate] ?? 0) + (DW[dueColDate] ?? 0);
      const barW     = Math.max(barRight - barLeft, 0.5);
      const barTop   = Math.round((rowH - barH) / 2);

      html += `<div style="position:absolute;left:${barLeft.toFixed(3)}%;width:calc(${barW.toFixed(3)}% - 1px);min-width:20px;`
            + `top:${barTop}px;height:${barH}px;background:${c.bg};border:0.5px solid ${c.bo};border-radius:3px;z-index:3;`
            + `display:flex;align-items:center;overflow:hidden;pointer-events:none;">`;
      html += `<span style="font-size:10px;padding:0 4px;color:${c.tx};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(story.summary)}</span>`;
      html += `</div>`;
      if (story.points > 0 && barW > 5) {
        html += `<div style="position:absolute;right:calc(${(100 - barRight).toFixed(3)}% + 3px);top:${barTop}px;font-size:8px;color:${c.tx};opacity:0.8;z-index:4;pointer-events:none;line-height:${barH}px;">${story.points}pt</div>`;
      }
    } else if (isUnscheduled) {
      const barTop = Math.round((rowH - barH) / 2);
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
