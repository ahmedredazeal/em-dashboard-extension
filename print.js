const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_NAMES   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function fmtDate(dayStr) {
  const d = new Date(dayStr + 'T00:00:00');
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}
function fmtShort(dayStr) {
  const d = new Date(dayStr + 'T00:00:00');
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
}
function dayName(dayStr) {
  return DAY_NAMES[new Date(dayStr + 'T00:00:00').getDay()];
}
function daysBetween(d1, d2) {
  return Math.round((new Date(d2) - new Date(d1)) / 86400000);
}

function buildChart(samples, W, H) {
  if (!samples || samples.length === 0) return '<p style="color:#94a3b8;font-size:13px;">No data.</p>';

  const counts = samples.map(s => s.count);
  const days   = samples.map(s => s.day);
  const minVal = Math.min(...counts);
  const maxVal = Math.max(...counts);

  const PAD_L = 44, PAD_R = 16, PAD_T = 12, PAD_B = 28;
  const PW = W - PAD_L - PAD_R;
  const PH = H - PAD_T - PAD_B;

  // Y-axis with padding
  const yPad  = Math.max(Math.ceil(maxVal * 0.15), 3);
  const yMin  = Math.max(0, minVal - yPad);
  const yMax  = maxVal + yPad;
  const yRange = yMax - yMin || 1;

  // Date-normalised x-axis
  const firstMs = new Date(days[0]).getTime();
  const lastMs  = new Date(days[days.length - 1]).getTime();
  const totalMs = lastMs - firstMs || 1;
  const pxD = (day) => PAD_L + ((new Date(day).getTime() - firstMs) / totalMs) * PW;
  const pyV = (v)   => PAD_T + PH - ((v - yMin) / yRange) * PH;

  // Grid lines + y-axis labels
  const yStep = Math.ceil((yMax - yMin) / 4);
  let grid = '', ylbl = '';
  for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax; v += yStep) {
    const y = pyV(v).toFixed(1);
    grid += `<line x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}" stroke="#e2e8f0" stroke-width="1"/>`;
    ylbl += `<text x="${PAD_L - 6}" y="${y}" text-anchor="end" dominant-baseline="central" fill="#94a3b8" font-size="10" font-family="system-ui">${v}</text>`;
  }

  // X-axis: one label per week (or every N days if span < 7)
  let xlbl = '';
  const spanDays = daysBetween(days[0], days[days.length - 1]);
  const labelEvery = spanDays <= 7 ? 1 : spanDays <= 30 ? 7 : 14;
  const labelledDays = new Set();
  for (const s of samples) {
    const d = new Date(s.day);
    const dayOfYear = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
    if (dayOfYear % labelEvery === 0 || s === samples[0] || s === samples[samples.length-1]) {
      const x = pxD(s.day).toFixed(1);
      if (!labelledDays.has(s.day)) {
        const txt = s === samples[samples.length-1] ? 'today' : fmtShort(s.day);
        const anchor = s === samples[0] ? 'start' : s === samples[samples.length-1] ? 'end' : 'middle';
        xlbl += `<text x="${x}" y="${H - 6}" text-anchor="${anchor}" fill="#94a3b8" font-size="10" font-family="system-ui">${txt}</text>`;
        labelledDays.add(s.day);
      }
    }
  }

  // Gap detection → segments
  const segments = [];
  let streak = [samples[0]];
  for (let i = 1; i < samples.length; i++) {
    const diff = daysBetween(samples[i-1].day, samples[i].day);
    if (diff > 1) {
      segments.push({ type: 'data', points: [...streak] });
      segments.push({ type: 'gap', start: samples[i-1].day, end: samples[i].day, days: diff - 1 });
      streak = [samples[i]];
    } else {
      streak.push(samples[i]);
    }
  }
  segments.push({ type: 'data', points: streak });

  let parts = '';

  // Gap rectangles
  for (const seg of segments) {
    if (seg.type !== 'gap') continue;
    const x1 = pxD(seg.start), x2 = pxD(seg.end);
    const gw = x2 - x1;
    const mx = ((x1 + x2) / 2).toFixed(1);
    const my = (PAD_T + PH / 2).toFixed(1);
    parts += `<rect x="${x1.toFixed(1)}" y="${PAD_T}" width="${gw.toFixed(1)}" height="${PH}" fill="#f1f5f9" rx="2"/>`;
    if (gw > 36) {
      parts += `<text x="${mx}" y="${my}" text-anchor="middle" dominant-baseline="central" fill="#94a3b8" font-size="9" font-family="system-ui">no data · ${seg.days}d</text>`;
    }
  }

  // Polyline segments + area fills
  for (const seg of segments) {
    if (seg.type !== 'data' || seg.points.length === 0) continue;
    const pts = seg.points.map(s => `${pxD(s.day).toFixed(1)},${pyV(s.count).toFixed(1)}`).join(' ');
    if (seg.points.length > 1) {
      const fx = pxD(seg.points[0].day).toFixed(1);
      const lx = pxD(seg.points[seg.points.length-1].day).toFixed(1);
      const by = (PAD_T + PH).toFixed(1);
      parts += `<path d="M${fx},${by} L${pts.split(' ').join(' L')} L${lx},${by} Z" fill="#6366f1" fill-opacity="0.08"/>`;
    }
    parts += `<polyline points="${pts}" fill="none" stroke="#6366f1" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  }

  // Dots on each sample
  for (const s of samples) {
    parts += `<circle cx="${pxD(s.day).toFixed(1)}" cy="${pyV(s.count).toFixed(1)}" r="2.5" fill="#6366f1"/>`;
  }

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;display:block;">
    <line x1="${PAD_L}" y1="${PAD_T}" x2="${PAD_L}" y2="${PAD_T+PH}" stroke="#e2e8f0" stroke-width="1"/>
    <line x1="${PAD_L}" y1="${PAD_T+PH}" x2="${W-PAD_R}" y2="${PAD_T+PH}" stroke="#e2e8f0" stroke-width="1"/>
    ${grid}${parts}${ylbl}${xlbl}
  </svg>`;
}

async function render() {
  // Data is passed directly in the URL query param — no storage dependency.
  let data;
  try {
    const raw = new URLSearchParams(window.location.search).get('data');
    if (!raw) throw new Error('No data param in URL');
    data = JSON.parse(decodeURIComponent(raw));
  } catch (e) {
    document.body.innerHTML = `<p style="padding:40px;color:#ef4444;">Could not load export data: ${e.message}.<br>Please press the ⬇ button on the Sentry trend chart to export again.</p>`;
    return;
  }

  if (!data || !Array.isArray(data.samples) || data.samples.length === 0) {
    document.body.innerHTML = '<p style="padding:40px;color:#94a3b8;">No samples found in this export. Please press the ⬇ button on the Sentry trend chart when it has at least one reading.</p>';
    return;
  }

  const { viewLabel, viewId, samples, exportedAt } = data;
  const last30 = samples.slice(-30);

  // Header
  document.getElementById('exp-title').textContent = `${viewLabel} · Issue Trend`;
  document.getElementById('exp-meta').textContent = `View ID: ${viewId} · ${last30.length} reading${last30.length === 1 ? '' : 's'}`;
  document.getElementById('exp-badge').textContent = `Exported ${new Date(exportedAt).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })}`;
  document.title = `EM Dashboard — ${viewLabel} Trend Export`;
  document.getElementById('footer-view').textContent = `View: ${viewLabel} (${viewId})`;

  // Summary
  const counts = last30.map(s => s.count);
  const minVal = Math.min(...counts), maxVal = Math.max(...counts), avgVal = Math.round(counts.reduce((s,c) => s+c,0)/counts.length);
  const latest = last30[last30.length-1];
  const prev   = last30.length > 1 ? last30[last30.length-2] : null;
  const delta = prev ? latest.count - prev.count : 0;
  const deltaStr = delta > 0 ? `↑ ${delta}` : delta < 0 ? `↓ ${Math.abs(delta)}` : '= 0';
  const deltaClass = delta > 0 ? 'up' : delta < 0 ? 'down' : '';

  const cards = [
    { value: latest.count, label: 'Current', cls: '' },
    { value: deltaStr, label: 'vs Yesterday', cls: deltaClass },
    { value: minVal, label: 'Min', cls: 'down' },
    { value: maxVal, label: 'Max', cls: 'up' },
    { value: avgVal, label: 'Avg', cls: '' },
  ];
  document.getElementById('summary-grid').innerHTML = cards.map(c =>
    `<div class="summary-card ${c.cls}"><div class="summary-value">${c.value}</div><div class="summary-label">${c.label}</div></div>`
  ).join('');

  // Chart
  document.getElementById('chart-container').innerHTML = buildChart(last30, 740, 180);

  // Table
  const tbody = document.getElementById('data-tbody');
  let rows = '';
  for (let i = 0; i < last30.length; i++) {
    const s = last30[i];
    const p = i > 0 ? last30[i-1] : null;

    // Gap row before this entry?
    if (p) {
      const diff = daysBetween(p.day, s.day);
      if (diff > 1) {
        rows += `<tr class="td-gap"><td colspan="4">⬡ No data recorded · ${diff-1} day${diff-1===1?'':'s'} gap (${fmtShort(p.day)} → ${fmtShort(s.day)})</td></tr>`;
      }
    }

    const d = s.count - (p?.count ?? s.count);
    const dStr = p ? (d > 0 ? `↑ ${d}` : d < 0 ? `↓ ${Math.abs(d)}` : '= 0') : '—';
    const dCls = p ? (d > 0 ? 'up' : d < 0 ? 'down' : 'flat') : 'flat';
    rows += `<tr>
      <td class="td-date">${fmtDate(s.day)}</td>
      <td style="color:#64748b;font-size:12px;">${dayName(s.day)}</td>
      <td class="td-count">${s.count}</td>
      <td class="td-delta ${dCls}">${dStr}</td>
    </tr>`;
  }
  tbody.innerHTML = rows;

  // Auto-print after a short delay for layout to settle
  setTimeout(() => window.print(), 600);
}

render();
