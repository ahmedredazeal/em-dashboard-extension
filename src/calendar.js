/**
 * src/calendar.js — Zealer Dashboard (T-CAL-1, phase 1)
 *
 * Pure, dependency-free core for the Google Calendar (ICS) feature. No chrome,
 * no DOM, no network — fetching is done by the caller; this module only PARSES
 * ICS text and DERIVES the "today" view + countdown/alert state. Same pure-core
 * pattern as monthly-report.js / bug-reports.js.
 *
 * Auth approach is the private iCal/ICS URL (Option A, locked in
 * docs/T-CAL-1-PLAN.md). ICS is pull-only — the caller polls and feeds the text
 * here.
 *
 * Normalized meeting shape:
 *   { id, title, start: ISO|null, end: ISO|null, allDay: bool, location, attendeesCount }
 */

export const ALERT_THRESHOLD_MIN = 30;

/** Local YYYY-MM-DD for a Date (matches monthly-report.dayKey semantics). */
export function dayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Unfold ICS lines: per RFC 5545, long lines are folded with CRLF + a leading
 * space/tab on the continuation. Join those back before parsing.
 */
function unfold(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, ''); // continuation → join to previous line
}

/**
 * Parse an ICS date/time value into { date: Date, allDay: bool }.
 * Handles:
 *   - VALUE=DATE (all-day): "20260618" → local midnight, allDay true
 *   - UTC: "20260618T093000Z"
 *   - Floating / TZID: "20260618T093000" — interpreted as LOCAL time. (Full IANA
 *     TZID conversion is out of scope for phase 1; floating local is correct for
 *     the common case where the calendar's tz matches the viewer's. Documented
 *     limitation in the plan.)
 */
export function parseIcsDate(raw, params = {}) {
  if (!raw) return { date: null, allDay: false };
  const value = String(raw).trim();

  // All-day: YYYYMMDD with no time component (or VALUE=DATE param).
  const isDateOnly = params.VALUE === 'DATE' || /^\d{8}$/.test(value);
  if (isDateOnly) {
    const y = +value.slice(0, 4), mo = +value.slice(4, 6), d = +value.slice(6, 8);
    return { date: new Date(y, mo - 1, d), allDay: true };
  }

  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!m) return { date: null, allDay: false };
  const [, y, mo, d, h, mi, s, z] = m;
  if (z === 'Z') {
    return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)), allDay: false };
  }
  // Floating / TZID → treat as local.
  return { date: new Date(+y, +mo - 1, +d, +h, +mi, +s), allDay: false };
}

/** Split a property line "NAME;PARAM=x:value" → { name, params, value }. */
function parseLine(line) {
  const colon = line.indexOf(':');
  if (colon === -1) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = left.split(';');
  const name = parts[0].toUpperCase();
  const params = {};
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf('=');
    if (eq !== -1) params[parts[i].slice(0, eq).toUpperCase()] = parts[i].slice(eq + 1);
  }
  return { name, params, value };
}

function unescapeText(v) {
  return String(v || '')
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

/**
 * Parse ICS text into an array of normalized meetings (NOT yet filtered to
 * today). Recurrence: phase 1 does a minimal expansion — a daily RRULE is
 * expanded into today's instance if today is on/after DTSTART; weekly RRULE with
 * BYDAY is expanded if today's weekday matches. Anything more exotic is taken at
 * its DTSTART occurrence only (documented limitation).
 */
export function parseICS(text, now = new Date()) {
  const lines = unfold(text).split('\n');
  const meetings = [];
  let cur = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = { params: {} }; continue; }
    if (line === 'END:VEVENT') { if (cur) meetings.push(finalizeEvent(cur)); cur = null; continue; }
    if (!cur) continue;

    const p = parseLine(line);
    if (!p) continue;
    switch (p.name) {
      case 'UID': cur.id = p.value; break;
      case 'SUMMARY': cur.title = unescapeText(p.value); break;
      case 'LOCATION': cur.location = unescapeText(p.value); break;
      case 'DTSTART': { const d = parseIcsDate(p.value, p.params); cur.start = d.date; cur.allDay = d.allDay; break; }
      case 'DTEND': { const d = parseIcsDate(p.value, p.params); cur.end = d.date; break; }
      case 'RRULE': cur.rrule = p.value; break;
      case 'ATTENDEE': cur.attendees = (cur.attendees || 0) + 1; break;
      case 'STATUS': cur.status = p.value; break;
      default: break;
    }
  }

  // Expand simple recurrences into today where applicable.
  const expanded = [];
  for (const m of meetings) {
    if (m.status === 'CANCELLED') continue;
    expanded.push(m);
    const extra = expandRecurrenceForToday(m, now);
    if (extra) expanded.push(extra);
  }
  return expanded;
}

function finalizeEvent(cur) {
  return {
    id: cur.id || cryptoishId(cur),
    title: cur.title || '(no title)',
    start: cur.start ? cur.start.toISOString() : null,
    end: cur.end ? cur.end.toISOString() : null,
    allDay: !!cur.allDay,
    location: cur.location || '',
    attendeesCount: cur.attendees || 0,
    status: cur.status || null,
    _startDate: cur.start || null,
    rrule: cur.rrule || null,
  };
}

function cryptoishId(cur) {
  return 'evt-' + (cur.title || '') + '-' + (cur.start ? cur.start.getTime() : Math.random());
}

/**
 * Minimal RRULE expansion: returns a single "today" instance of a recurring
 * event if the rule clearly produces one, else null. Conservative by design.
 */
function expandRecurrenceForToday(m, now) {
  if (!m.rrule || !m._startDate) return null;
  const rule = Object.fromEntries(m.rrule.split(';').map(kv => kv.split('=')).map(([k, v]) => [k.toUpperCase(), v]));
  const freq = rule.FREQ;
  const startDate = m._startDate;
  // UNTIL guard
  if (rule.UNTIL) {
    const u = parseIcsDate(rule.UNTIL).date;
    if (u && now > u) return null;
  }
  if (now < startOfDay(startDate)) return null; // not started yet

  const todayMatches = (() => {
    if (freq === 'DAILY') return true;
    if (freq === 'WEEKLY') {
      const byday = (rule.BYDAY || icsWeekday(startDate)).split(',');
      return byday.includes(icsWeekday(now));
    }
    return false; // MONTHLY/YEARLY/other → not expanded in phase 1
  })();
  if (!todayMatches) return null;

  // Already today? then the base event is the instance; no extra.
  if (dayKey(startDate) === dayKey(now)) return null;

  // Build today's instance at the same wall-clock time as DTSTART.
  if (m.allDay) {
    const s = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { ...m, start: s.toISOString(), end: null, _startDate: s, rrule: null, id: m.id + '::' + dayKey(now) };
  }
  const s = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startDate.getHours(), startDate.getMinutes(), startDate.getSeconds());
  let e = null;
  if (m.end && m._startDate) {
    const durMs = new Date(m.end).getTime() - startDate.getTime();
    e = new Date(s.getTime() + durMs);
  }
  return { ...m, start: s.toISOString(), end: e ? e.toISOString() : null, _startDate: s, rrule: null, id: m.id + '::' + dayKey(now) };
}

function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function icsWeekday(d) { return ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][d.getDay()]; }

/**
 * Reduce parsed meetings to today's view.
 * @returns {{ timed: [], allDay: [], next: meeting|null }}
 *   timed sorted by start; allDay separate; next = earliest upcoming or in-progress.
 */
export function todaysMeetings(meetings, now = new Date()) {
  const tk = dayKey(now);
  const todays = (meetings || []).filter(m => m.start && dayKey(new Date(m.start)) === tk);
  const allDay = todays.filter(m => m.allDay).sort(byStart);
  const timed = todays.filter(m => !m.allDay).sort(byStart);
  const next = pickNext(timed, now);
  return { timed, allDay, next };
}

function byStart(a, b) { return new Date(a.start).getTime() - new Date(b.start).getTime(); }

/** Earliest meeting that is upcoming OR currently in progress. */
function pickNext(timed, now) {
  const t = now.getTime();
  let inProgress = null, upcoming = null;
  for (const m of timed) {
    const s = new Date(m.start).getTime();
    const e = m.end ? new Date(m.end).getTime() : s + 30 * 60000;
    if (s <= t && t < e) { if (!inProgress) inProgress = m; }
    else if (s > t) { if (!upcoming || s < new Date(upcoming.start).getTime()) upcoming = m; }
  }
  return upcoming || inProgress || null;
}

/**
 * Countdown + alert state for the next meeting.
 * @returns {{ status, minutesUntil, alert, label }}
 *   status: 'none' | 'in_progress' | 'upcoming'
 *   alert: true when 0 < minutesUntil <= ALERT_THRESHOLD_MIN
 */
export function countdownState(next, now = new Date(), thresholdMin = ALERT_THRESHOLD_MIN) {
  if (!next || !next.start) return { status: 'none', minutesUntil: null, alert: false, label: '' };
  const t = now.getTime();
  const s = new Date(next.start).getTime();
  const e = next.end ? new Date(next.end).getTime() : s + 30 * 60000;

  if (s <= t && t < e) {
    const minsLeft = Math.ceil((e - t) / 60000);
    return { status: 'in_progress', minutesUntil: 0, minutesLeft: minsLeft, alert: false, label: 'In progress' };
  }
  const minutesUntil = Math.ceil((s - t) / 60000);
  const alert = minutesUntil > 0 && minutesUntil <= thresholdMin;
  return { status: 'upcoming', minutesUntil, alert, label: formatCountdown(minutesUntil) };
}

/** "in 5m", "in 1h 20m". */
export function formatCountdown(minutes) {
  if (minutes == null || minutes < 0) return '';
  if (minutes === 0) return 'now';
  const h = Math.floor(minutes / 60), m = minutes % 60;
  if (h === 0) return `in ${m}m`;
  if (m === 0) return `in ${h}h`;
  return `in ${h}h ${m}m`;
}

/** "9:00 AM" style local time label for a meeting start. */
export function timeLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  let h = d.getHours(); const m = d.getMinutes();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')} ${ap}`;
}
