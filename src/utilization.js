/**
 * src/utilization.js — em-dashboard
 *
 * Pure helpers for the "Time Utilization" overlay: turn a Google Calendar
 * `freebusy.query` response into busy-hours per person, so the Time Logged
 * chart can show logged work alongside meeting/busy time.
 *
 * Privacy by construction: freebusy returns ONLY busy {start,end} blocks — no
 * titles, attendees, or any event detail — so nothing here can leak what a
 * meeting is about. We only ever compute durations.
 *
 * Policy (v1): count ALL busy time. Overlapping blocks are merged so concurrent
 * invites are never double-counted. (A future option may clip to working hours
 * or exclude all-day blocks; kept out for now per the agreed scope.)
 *
 * DOM-free and network-free so it can be unit-tested. The OAuth + fetch live in
 * src/gcal-auth.js; the chart rendering in src/render/timesheet-svg.js.
 */

/**
 * Merge overlapping/adjacent [start,end] intervals (ms epoch numbers).
 * @param {{start:number,end:number}[]} intervals
 * @returns {{start:number,end:number}[]} disjoint, sorted by start
 */
export function mergeIntervals(intervals) {
  const valid = (intervals || [])
    .filter(iv => iv && iv.end > iv.start)
    .sort((a, b) => a.start - b.start);
  const out = [];
  for (const iv of valid) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end);
    } else {
      out.push({ start: iv.start, end: iv.end });
    }
  }
  return out;
}

/**
 * Total busy hours across a set of busy blocks, merging overlaps first.
 * @param {{start:string,end:string}[]} busy  freebusy blocks (RFC3339 strings)
 * @returns {number} hours (2dp)
 */
export function busyHours(busy) {
  const ms = mergeIntervals((busy || []).map(b => ({
    start: Date.parse(b.start), end: Date.parse(b.end),
  }))).reduce((sum, iv) => sum + (iv.end - iv.start), 0);
  return Math.round((ms / 3.6e6) * 100) / 100;
}

/**
 * Busy hours per calendar id (email) from a freebusy.query response.
 * Calendars that returned an error (e.g. notFound / restricted) are skipped.
 * @param {object} resp  the freebusy.query response body
 * @returns {Object<string,number>}  { "user@domain": hours }
 */
export function busyHoursByEmail(resp) {
  const cals = (resp && resp.calendars) || {};
  const out = {};
  for (const [email, info] of Object.entries(cals)) {
    if (info && Array.isArray(info.busy) && (!info.errors || info.errors.length === 0)) {
      out[email] = busyHours(info.busy);
    }
  }
  return out;
}

/**
 * Busy hours per email per local day, for a future per-day overlay.
 * @param {object} resp  freebusy.query response
 * @param {number} [tzOffsetMinutes=0]  minutes to add to UTC for local day
 *   bucketing (e.g. Cairo summer = +180). A block spanning midnight is split.
 * @returns {Object<string,Object<string,number>>} { email: { "YYYY-MM-DD": h } }
 */
export function busyHoursByEmailPerDay(resp, tzOffsetMinutes = 0) {
  const cals = (resp && resp.calendars) || {};
  const off = tzOffsetMinutes * 60000;
  const dayKey = (msUtc) => new Date(msUtc + off).toISOString().slice(0, 10);
  const out = {};
  for (const [email, info] of Object.entries(cals)) {
    if (!info || !Array.isArray(info.busy) || (info.errors && info.errors.length)) continue;
    const perDay = {};
    for (const iv of mergeIntervals(info.busy.map(b => ({ start: Date.parse(b.start), end: Date.parse(b.end) })))) {
      let cur = iv.start;
      while (cur < iv.end) {
        const k = dayKey(cur);
        // end of this local day in UTC ms
        const dayEndLocal = new Date(new Date(cur + off).toISOString().slice(0, 10) + 'T23:59:59.999Z').getTime() - off + 1;
        const slice = Math.min(iv.end, dayEndLocal) - cur;
        perDay[k] = Math.round(((perDay[k] || 0) + slice / 3.6e6) * 100) / 100;
        cur += slice;
      }
    }
    out[email] = perDay;
  }
  return out;
}

/**
 * Attach busy hours to timesheet member rows.
 * @param {Array<{name:string,total:number,byProject:object}>} members
 * @param {Object<string,string>} emailByMember  member name → email
 * @param {Object<string,number>} busyByEmail    email → busy hours
 * @returns {Array} members with `busyHours` added (0 when unmapped/unknown)
 */
export function attachBusyToMembers(members, emailByMember, busyByEmail) {
  const norm = s => String(s ?? '').trim().toLowerCase();
  // Normalize both sides so trivial case/whitespace differences still match
  // (member display names vs. the Settings map; emails vs. Google's keys).
  const emailByNameN = {};
  for (const [name, email] of Object.entries(emailByMember || {})) emailByNameN[norm(name)] = norm(email);
  const busyByEmailN = {};
  for (const [email, h] of Object.entries(busyByEmail || {})) busyByEmailN[norm(email)] = h;
  return (members || []).map(m => {
    const email = emailByNameN[norm(m.name)];
    const busy = (email && busyByEmailN[email]) || 0;
    return { ...m, busyHours: Math.round(busy * 100) / 100 };
  });
}
