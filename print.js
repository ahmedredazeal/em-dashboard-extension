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


const TREND_COLORS = ['#6366f1','#22c55e','#f59e0b','#ec4899','#06b6d4','#a855f7','#ef4444','#14b8a6'];

/**
 * Multi-series line chart for the print/PDF page.
 * @param {Array<{label,color,samples:Array<{day,count}>}>} series
 */
function buildMultiChart(series, W, H) {
  const withData = series.filter(s => s.samples && s.samples.length > 0);
  if (withData.length === 0) return '<p style="color:#94a3b8;font-size:13px;">No data.</p>';

  const PAD_L = 44, PAD_R = 16, PAD_T = 12, PAD_B = 28;
  const PW = W - PAD_L - PAD_R;
  const PH = H - PAD_T - PAD_B;

  // Shared axes across all series
  const allDays = [], allCounts = [];
  withData.forEach(s => s.samples.forEach(p => { allDays.push(p.day); allCounts.push(p.count); }));

  const minVal = Math.min(...allCounts);
  const maxVal = Math.max(...allCounts);
  const yPad   = Math.max(Math.ceil(maxVal * 0.15), 3);
  const yMin   = Math.max(0, minVal - yPad);
  const yMax   = maxVal + yPad;
  const yRange = yMax - yMin || 1;

  const allMs   = allDays.map(d => new Date(d).getTime());
  const firstMs = Math.min(...allMs);
  const lastMs  = Math.max(...allMs);
  const totalMs = lastMs - firstMs || 1;

  const pxD = (day) => PAD_L + ((new Date(day).getTime() - firstMs) / totalMs) * PW;
  const pyV = (v)   => PAD_T + PH - ((v - yMin) / yRange) * PH;

  // Grid + y labels
  const yStep = Math.ceil((yMax - yMin) / 4);
  let grid = '', ylbl = '';
  for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax; v += yStep) {
    const y = pyV(v).toFixed(1);
    grid += `<line x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}" stroke="#e2e8f0" stroke-width="1"/>`;
    ylbl += `<text x="${PAD_L - 6}" y="${y}" text-anchor="end" dominant-baseline="central" fill="#94a3b8" font-size="10" font-family="system-ui">${v}</text>`;
  }

  // X labels: first + today
  const fmt = d => `${parseInt(d.slice(8))} ${MONTH_NAMES[parseInt(d.slice(5,7))-1]}`;
  const firstDay = new Date(firstMs).toISOString().slice(0,10);
  let xlbl = `<text x="${PAD_L}" y="${H-6}" text-anchor="start" fill="#94a3b8" font-size="10" font-family="system-ui">${fmt(firstDay)}</text>`;
  xlbl    += `<text x="${(W-PAD_R).toFixed(1)}" y="${H-6}" text-anchor="end" fill="#94a3b8" font-size="10" font-family="system-ui">today</text>`;

  // One polyline set per series (broken at gaps)
  let lines = '';
  const showGaps = withData.length === 1;
  for (const s of withData) {
    const pts = s.samples;
    const segs = [];
    let streak = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const diff = daysBetween(pts[i-1].day, pts[i].day);
      if (diff > 1) { segs.push({ type:'data', points:[...streak] }); segs.push({ type:'gap', start:pts[i-1].day, end:pts[i].day, days:diff-1 }); streak=[pts[i]]; }
      else streak.push(pts[i]);
    }
    segs.push({ type:'data', points:streak });

    if (showGaps) {
      for (const seg of segs) {
        if (seg.type !== 'gap') continue;
        const x1 = pxD(seg.start), x2 = pxD(seg.end), gw = x2 - x1;
        lines += `<rect x="${x1.toFixed(1)}" y="${PAD_T}" width="${gw.toFixed(1)}" height="${PH}" fill="#f1f5f9" rx="2"/>`;
        if (gw > 36) {
          const mx = ((x1+x2)/2).toFixed(1), my = (PAD_T+PH/2).toFixed(1);
          lines += `<text x="${mx}" y="${my}" text-anchor="middle" dominant-baseline="central" fill="#94a3b8" font-size="9" font-family="system-ui">no data · ${seg.days}d</text>`;
        }
      }
    }
    for (const seg of segs) {
      if (seg.type !== 'data' || seg.points.length === 0) continue;
      const sp = seg.points.map(p => `${pxD(p.day).toFixed(1)},${pyV(p.count).toFixed(1)}`).join(' ');
      lines += `<polyline points="${sp}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    }
    for (const p of pts) {
      lines += `<circle cx="${pxD(p.day).toFixed(1)}" cy="${pyV(p.count).toFixed(1)}" r="2.5" fill="${s.color}"/>`;
    }
  }

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;display:block;">
    <line x1="${PAD_L}" y1="${PAD_T}" x2="${PAD_L}" y2="${PAD_T+PH}" stroke="#e2e8f0" stroke-width="1"/>
    <line x1="${PAD_L}" y1="${PAD_T+PH}" x2="${W-PAD_R}" y2="${PAD_T+PH}" stroke="#e2e8f0" stroke-width="1"/>
    ${grid}${lines}${ylbl}${xlbl}
  </svg>`;
}

function esc(str) {
  return String(str).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}

async function render() {
  // Data is passed directly in the URL query param — no storage dependency.
  let data;
  try {
    const raw = new URLSearchParams(window.location.search).get('data');
    if (!raw) throw new Error('No data param in URL');
    data = JSON.parse(decodeURIComponent(raw));
  } catch (e) {
    // The data param is attacker-influenceable; escape the error before innerHTML.
    const safeMsg = String((e && e.message) || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    document.body.innerHTML = `<p style="padding:40px;color:#ef4444;">Could not load export data: ${safeMsg}.<br>Please press the ⬇ button on the Sentry trend chart to export again.</p>`;
    return;
  }

  // Normalise both formats into a series array.
  //   v2 multi: { mode, series:[{viewId,viewLabel,color,samples}] }
  //   legacy:   { viewId, viewLabel, samples }
  let series;
  if (Array.isArray(data.series)) {
    series = data.series.map((s, i) => ({
      viewId: s.viewId, label: s.viewLabel || s.label || `View ${s.viewId}`,
      color: s.color || TREND_COLORS[i % TREND_COLORS.length],
      samples: (s.samples || []).slice(-30),
    }));
  } else if (Array.isArray(data.samples)) {
    series = [{ viewId: data.viewId, label: data.viewLabel || `View ${data.viewId}`,
                color: TREND_COLORS[0], samples: data.samples.slice(-30) }];
  } else {
    series = [];
  }

  series = series.filter(s => s.samples.length > 0);
  if (series.length === 0) {
    document.body.innerHTML = '<p style="padding:40px;color:#94a3b8;">No samples found in this export. Press the ⬇ button on the Sentry trend chart when it has at least one reading.</p>';
    return;
  }

  const isMulti = series.length > 1;
  const exportedAt = data.exportedAt || new Date().toISOString();

  // ── Header ────────────────────────────────────────────────────────────
  const titleText = isMulti ? 'Sentry Issue Trends — All Tracked Views' : `${series[0].label} · Issue Trend`;
  document.getElementById('exp-title').textContent = titleText;
  document.title = `Zealer Dashboard — ${isMulti ? 'Multi-View' : series[0].label} Trend Export`;
  document.getElementById('exp-badge').textContent = `Exported ${new Date(exportedAt).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })}`;

  if (isMulti) {
    document.getElementById('exp-meta').textContent = `${series.length} views`;
    document.getElementById('footer-view').textContent = `Views: ${series.map(s => s.label).join(', ')}`;
  } else {
    const s = series[0];
    document.getElementById('exp-meta').textContent = `View ID: ${s.viewId} · ${s.samples.length} reading${s.samples.length === 1 ? '' : 's'}`;
    document.getElementById('footer-view').textContent = `View: ${s.label} (${s.viewId})`;
  }

  // ── Summary cards ─────────────────────────────────────────────────────
  if (isMulti) {
    // One mini card per view: label, current, delta
    document.getElementById('summary-grid').style.gridTemplateColumns = `repeat(${Math.min(series.length, 5)}, 1fr)`;
    document.getElementById('summary-grid').innerHTML = series.map(s => {
      const last = s.samples[s.samples.length-1], prev = s.samples.length > 1 ? s.samples[s.samples.length-2] : null;
      const d = prev ? last.count - prev.count : 0;
      const dStr = !prev ? '' : d > 0 ? `↑ ${d}` : d < 0 ? `↓ ${Math.abs(d)}` : '= 0';
      const cls = d > 0 ? 'up' : d < 0 ? 'down' : '';
      return `<div class="summary-card ${cls}">
        <div style="display:flex;align-items:center;justify-content:center;gap:5px;">
          <span style="width:9px;height:9px;border-radius:2px;background:${s.color};display:inline-block;"></span>
          <div class="summary-value">${last.count}</div>
        </div>
        <div class="summary-label">${esc(s.label)}${dStr ? ` · ${dStr}` : ''}</div>
      </div>`;
    }).join('');
  } else {
    const counts = series[0].samples.map(s => s.count);
    const minVal = Math.min(...counts), maxVal = Math.max(...counts), avgVal = Math.round(counts.reduce((a,c)=>a+c,0)/counts.length);
    const last = series[0].samples[series[0].samples.length-1];
    const prev = series[0].samples.length > 1 ? series[0].samples[series[0].samples.length-2] : null;
    const delta = prev ? last.count - prev.count : 0;
    const deltaStr = delta > 0 ? `↑ ${delta}` : delta < 0 ? `↓ ${Math.abs(delta)}` : '= 0';
    const cards = [
      { value: last.count, label: 'Current', cls: '' },
      { value: deltaStr, label: 'vs Yesterday', cls: delta > 0 ? 'up' : delta < 0 ? 'down' : '' },
      { value: minVal, label: 'Min', cls: 'down' },
      { value: maxVal, label: 'Max', cls: 'up' },
      { value: avgVal, label: 'Avg', cls: '' },
    ];
    document.getElementById('summary-grid').innerHTML = cards.map(c =>
      `<div class="summary-card ${c.cls}"><div class="summary-value">${c.value}</div><div class="summary-label">${c.label}</div></div>`
    ).join('');
  }

  // ── Chart ─────────────────────────────────────────────────────────────
  document.getElementById('chart-container').innerHTML = buildMultiChart(series, 740, 180);

  // ── Table ─────────────────────────────────────────────────────────────
  const thead = document.querySelector('thead tr');
  const tbody = document.getElementById('data-tbody');

  if (isMulti) {
    // Columns: Date | Day | one count column per view
    thead.innerHTML = `<th>Date</th><th>Day</th>` +
      series.map(s => `<th style="text-align:right"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${s.color};margin-right:4px;"></span>${esc(s.label)}</th>`).join('');

    // Union of all days, sorted
    const dayset = new Set();
    series.forEach(s => s.samples.forEach(p => dayset.add(p.day)));
    const days = [...dayset].sort();

    // Lookup per view: day → count
    const lut = series.map(s => {
      const m = {}; s.samples.forEach(p => m[p.day] = p.count); return m;
    });

    tbody.innerHTML = days.map(day => {
      const cells = lut.map(m => `<td class="td-count">${m[day] != null ? m[day] : '<span style="color:#cbd5e1;">·</span>'}</td>`).join('');
      return `<tr><td class="td-date">${fmtDate(day)}</td><td style="color:#64748b;font-size:12px;">${dayName(day)}</td>${cells}</tr>`;
    }).join('');
  } else {
    const last30 = series[0].samples;
    let rows = '';
    for (let i = 0; i < last30.length; i++) {
      const s = last30[i], p = i > 0 ? last30[i-1] : null;
      if (p) {
        const diff = daysBetween(p.day, s.day);
        if (diff > 1) rows += `<tr class="td-gap"><td colspan="4">⬡ No data recorded · ${diff-1} day${diff-1===1?'':'s'} gap (${fmtShort(p.day)} → ${fmtShort(s.day)})</td></tr>`;
      }
      const d = s.count - (p?.count ?? s.count);
      const dStr = p ? (d > 0 ? `↑ ${d}` : d < 0 ? `↓ ${Math.abs(d)}` : '= 0') : '—';
      const dCls = p ? (d > 0 ? 'up' : d < 0 ? 'down' : 'flat') : 'flat';
      rows += `<tr><td class="td-date">${fmtDate(s.day)}</td><td style="color:#64748b;font-size:12px;">${dayName(s.day)}</td><td class="td-count">${s.count}</td><td class="td-delta ${dCls}">${dStr}</td></tr>`;
    }
    tbody.innerHTML = rows;
  }

  // Auto-print after layout settles
  setTimeout(() => window.print(), 600);
}

render();
