/**
 * tests/report-html.test.js — src/report-html.js (T-RPT-1)
 */
import { buildReportHTML, buildReportJSON, monthLabel, LIGHT_PALETTE } from '../src/report-html.js';
import { finalizeMonth, emptyBucket, updateBucket } from '../src/monthly-report.js';

let pass = 0, fail = 0;
function test(n, fn){try{fn();pass++;console.log(`  ✓ ${n}`);}catch(e){fail++;console.log(`  ✗ ${n}\n    ${e.message}`);}}
function assert(c,m='fail'){if(!c)throw new Error(m);}

function sampleFinalized() {
  let b = emptyBucket('2026-05', 'HRM', new Date(2026, 4, 1).toISOString());
  b = updateBucket(b, { day:'2026-05-10', flow:{bugsOpened:3,bugsResolved:2,supportOpened:1,supportClosed:4}, byEngineer:{'acc-a':{bugsOpened:2,bugsResolved:1}}, state:{openBugs:8,medianBugAge:6}, closedSprints:[{name:'S29',committedPts:20,completedPts:18,velocity:18,completionPct:90}] }, new Date(2026,4,10));
  return finalizeMonth(b, { total:160, perEngineer:{'acc-a':90} }, '2026-06-01T00:00:00Z');
}

console.log('\nmonthLabel');
test('formats YYYY-MM', () => assert(monthLabel('2026-05') === 'May 2026'));
test('passthrough on bad input', () => assert(monthLabel('x') === 'x'));

console.log('\nbuildReportHTML');
test('self-contained — no var(--...) leaks (F8)', () => {
  assert(!buildReportHTML(sampleFinalized()).includes('var(--'), 'palette must be resolved');
});
test('contains all sections', () => {
  const h = buildReportHTML(sampleFinalized());
  for (const s of ['Delivery', 'Bugs', 'Support', 'By engineer']) assert(h.includes(s), `missing ${s}`);
});
test('renders net flow direction', () => {
  assert(buildReportHTML(sampleFinalized()).includes('backlog'), 'net flow label');
});
test('hours unavailable handled', () => {
  let b = emptyBucket('2026-05', 'HRM', new Date(2026, 4, 1).toISOString());
  b = updateBucket(b, { day:'2026-05-10', flow:{bugsOpened:1,bugsResolved:0,supportOpened:0,supportClosed:0}, byEngineer:{}, state:{openBugs:1,medianBugAge:1}, closedSprints:[] }, new Date(2026,4,10));
  const fm = finalizeMonth(b, null);
  const h = buildReportHTML(fm);
  assert(h.includes('unavailable this month'), 'should note unavailable hours');
});
test('Me scope label + engineer name appear', () => {
  const h = buildReportHTML(sampleFinalized(), LIGHT_PALETTE, { scope: 'Me', engineerName: 'Ahmed Reda' });
  assert(h.includes('Ahmed Reda') && h.includes('>Me<'), 'me-scope badges');
});
test('partial month shows banner', () => {
  let b = emptyBucket('2026-05', 'HRM', new Date(2026, 4, 14).toISOString());
  b = updateBucket(b, { day:'2026-05-14', flow:{}, byEngineer:{}, state:{openBugs:1,medianBugAge:1}, closedSprints:[] }, new Date(2026,4,14));
  assert(buildReportHTML(finalizeMonth(b, null)).includes('Partial month'), 'partial banner');
});

console.log('\nbuildReportJSON');
test('valid JSON round-trips', () => {
  const fm = sampleFinalized();
  assert(JSON.parse(buildReportJSON(fm)).month === '2026-05');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
