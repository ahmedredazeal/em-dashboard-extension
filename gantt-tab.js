/**
 * gantt-tab.js — Zealer Dashboard
 *
 * Full-tab Gantt view. The popup writes a `ganttTabState` payload to
 * chrome.storage.local and opens this page in a new tab; we read it and render
 * the same buildGanttSVG used in the side panel, but at full width. A print
 * button calls window.print() for PDF export (A3 landscape recommended).
 *
 * Mirrors the Sprint Planner extension's gantt-print pattern.
 */
import { buildGanttSVG } from './src/gantt.js';

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

async function init() {
  const statusEl = document.getElementById('status');
  const container = document.getElementById('gantt-tab-container');
  try {
    const stored = await chrome.storage.local.get('ganttTabState');
    const gs = stored.ganttTabState;
    if (!gs || !gs.sprint || (!gs.stories?.length && !gs.subtasks?.length)) {
      statusEl.textContent = 'No sprint Gantt found. Open the dashboard, then click the expand icon on the Sprint Timeline.';
      return;
    }

    // Header
    document.getElementById('print-title').textContent =
      [gs.projectName, gs.sprint.name].filter(Boolean).join(' — ') || 'Sprint Gantt';
    const storyCount = (gs.stories || []).length;
    const subCount   = (gs.subtasks || []).length;
    document.getElementById('print-meta').innerHTML =
      (gs.sprint.startDate ? `${fmtDate(gs.sprint.startDate)} → ${fmtDate(gs.sprint.endDate)}` : '') +
      ` &nbsp;·&nbsp; ${storyCount} stor${storyCount === 1 ? 'y' : 'ies'}` +
      (subCount ? ` &nbsp;·&nbsp; ${subCount} subtask${subCount === 1 ? '' : 's'}` : '') +
      (gs.scope === 'me' ? ' &nbsp;·&nbsp; My timeline' : '');
    document.getElementById('print-generated').textContent =
      'Exported ' + new Date().toLocaleDateString('en-GB');

    // Render at full width: no filterMine here (the popup already narrowed the
    // payload when in "me" scope), wider label column, no minWidth clamp.
    const html = buildGanttSVG(
      gs.stories || [],
      gs.sprint,
      gs.workingDays || [0,1,2,3,4],
      gs.accountId || '',
      { filterMine: false, labelWidth: 240, subtasks: gs.subtasks || [] }
    );
    container.innerHTML = html;
    statusEl.style.display = 'none';

    // Click-through to Jira from the full-tab view too
    const base = (gs.jiraBaseUrl || '').replace(/\/$/, '');
    if (base) {
      container.addEventListener('click', e => {
        const el = e.target.closest('[data-jira-key]');
        if (!el) return;
        // Only open http(s) — base comes from stored settings; guard the scheme.
        try {
          const u = new URL(`${base}/browse/${el.dataset.jiraKey}`);
          if (u.protocol === 'https:' || u.protocol === 'http:') window.open(u.href, '_blank', 'noopener');
        } catch { /* invalid URL — ignore */ }
      });
    }
  } catch (e) {
    statusEl.textContent = 'Error: ' + e.message;
    console.error('[gantt-tab]', e);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  init();
  const btn = document.getElementById('print-btn');
  if (btn) btn.addEventListener('click', () => window.print());
});
