#!/usr/bin/env node
/**
 * tests/sentry-trend.test.js
 * Tests for src/sentry-trend.js
 *
 * Uses an in-memory mock of chrome.storage.sync so no browser is required.
 */

// ── Mock chrome.storage.sync ──────────────────────────────────────────────
const store = {};
global.chrome = {
  storage: {
    sync: {
      get: async (keys) => {
        if (keys === null) return { ...store };
        if (typeof keys === 'string') {
          return store[keys] !== undefined ? { [keys]: store[keys] } : {};
        }
        const result = {};
        for (const k of keys) if (store[k] !== undefined) result[k] = store[k];
        return result;
      },
      set: async (obj) => { Object.assign(store, obj); },
      remove: async (keys) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        for (const k of arr) delete store[k];
      },
    }
  }
};

function resetStore() {
  for (const k of Object.keys(store)) delete store[k];
}

import { recordTrendSample, getTrendSamples, pruneOldSamples, todayUTC } from '../src/sentry-trend.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message}`);
    fail++;
  }
}
async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message}`);
    fail++;
  }
}
function assert(val, msg = 'assertion failed') {
  if (!val) throw new Error(msg);
}
function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── todayUTC ──────────────────────────────────────────────────────────────
console.log('\ntodayUTC');
test('returns YYYY-MM-DD format', () => {
  const t = todayUTC();
  assert(/^\d{4}-\d{2}-\d{2}$/.test(t), `bad format: ${t}`);
});
test('day is between 01 and 31', () => {
  const day = parseInt(todayUTC().slice(8), 10);
  assert(day >= 1 && day <= 31, `day out of range: ${day}`);
});

// ── recordTrendSample ─────────────────────────────────────────────────────
console.log('\nrecordTrendSample');

await testAsync('writes today\'s count to sync storage', async () => {
  resetStore();
  await recordTrendSample('12345', 42);
  const today = todayUTC();
  const ym = today.slice(0, 7);
  const key = `sentryTrend:12345:${ym}`;
  assert(store[key], 'bucket not written');
  assert(store[key].viewId === '12345', 'wrong viewId');
  assert(store[key].yearMonth === ym, 'wrong yearMonth');
  const sample = store[key].samples.find(s => s.day === today);
  assert(sample, 'today sample not found');
  assert(sample.count === 42, `wrong count: ${sample.count}`);
});

await testAsync('overwriting same day replaces count', async () => {
  resetStore();
  await recordTrendSample('12345', 42);
  await recordTrendSample('12345', 99);
  const today = todayUTC();
  const ym = today.slice(0, 7);
  const key = `sentryTrend:12345:${ym}`;
  const samples = store[key].samples.filter(s => s.day === today);
  assert(samples.length === 1, `expected 1 sample, got ${samples.length}`);
  assert(samples[0].count === 99, `expected 99, got ${samples[0].count}`);
});

await testAsync('null viewId skips write', async () => {
  resetStore();
  await recordTrendSample(null, 10);
  assert(Object.keys(store).length === 0, 'should not have written anything');
});

await testAsync('null count skips write', async () => {
  resetStore();
  await recordTrendSample('abc', null);
  assert(Object.keys(store).length === 0, 'should not have written anything');
});

await testAsync('multiple calls on different days accumulate', async () => {
  resetStore();
  const today = todayUTC();
  const ym = today.slice(0, 7);
  const key = `sentryTrend:12345:${ym}`;
  // Pre-seed with a different day in same month
  store[key] = {
    viewId: '12345',
    yearMonth: ym,
    samples: [{ day: ym + '-01', count: 55 }]
  };
  await recordTrendSample('12345', 33);
  assert(store[key].samples.length === 2, `expected 2, got ${store[key].samples.length}`);
});

// ── getTrendSamples ───────────────────────────────────────────────────────
console.log('\ngetTrendSamples');

await testAsync('returns empty array when no data', async () => {
  resetStore();
  const result = await getTrendSamples('no-view');
  assert(Array.isArray(result) && result.length === 0, 'should be empty');
});

await testAsync('returns empty array for null viewId', async () => {
  resetStore();
  const result = await getTrendSamples(null);
  assert(Array.isArray(result) && result.length === 0, 'should be empty');
});

await testAsync('returns recorded samples sorted by day', async () => {
  resetStore();
  await recordTrendSample('777', 10);
  const today = todayUTC();
  const ym = today.slice(0, 7);
  // Pre-seed a slightly older entry in the same month
  const key = `sentryTrend:777:${ym}`;
  if (store[key]) {
    store[key].samples.push({ day: ym + '-01', count: 5 });
  }
  const results = await getTrendSamples('777');
  assert(results.length >= 1, 'expected at least 1 sample');
  // Should be sorted ascending
  for (let i = 1; i < results.length; i++) {
    assert(results[i].day >= results[i-1].day, `not sorted: ${results[i-1].day} > ${results[i].day}`);
  }
});

await testAsync('deduplicates same-day entries (keeps last)', async () => {
  resetStore();
  const today = todayUTC();
  const ym = today.slice(0, 7);
  const key = `sentryTrend:888:${ym}`;
  store[key] = {
    viewId: '888', yearMonth: ym,
    samples: [
      { day: today, count: 10 },
      { day: today, count: 20 },  // duplicate — last write wins after Map
    ]
  };
  const results = await getTrendSamples('888');
  const todaySamples = results.filter(s => s.day === today);
  assert(todaySamples.length === 1, `expected 1, got ${todaySamples.length}`);
});

await testAsync('each result has day and count fields', async () => {
  resetStore();
  await recordTrendSample('555', 42);
  const results = await getTrendSamples('555');
  assert(results.length > 0, 'no samples returned');
  for (const s of results) {
    assert(typeof s.day === 'string', 'day should be string');
    assert(typeof s.count === 'number', 'count should be number');
    assert(/^\d{4}-\d{2}-\d{2}$/.test(s.day), `bad day format: ${s.day}`);
  }
});

// ── pruneOldSamples ───────────────────────────────────────────────────────
console.log('\npruneOldSamples');

await testAsync('removes keys older than retention window', async () => {
  resetStore();
  const viewId = 'prune-test';
  // Plant 14 months of keys
  for (let i = 0; i < 14; i++) {
    const d = new Date(Date.UTC(2026, 5 - i, 1));
    const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2,'0')}`;
    store[`sentryTrend:${viewId}:${ym}`] = { viewId, yearMonth: ym, samples: [] };
  }
  assert(Object.keys(store).filter(k => k.startsWith(`sentryTrend:${viewId}:`)).length === 14, 'setup failed');
  
  await pruneOldSamples(viewId, '2026-06');
  
  const remaining = Object.keys(store).filter(k => k.startsWith(`sentryTrend:${viewId}:`));
  assert(remaining.length <= 12, `expected ≤12 buckets, got ${remaining.length}`);
});

await testAsync('does not remove buckets within retention window', async () => {
  resetStore();
  const viewId = 'prune-safe';
  // Plant only 3 months — all within window
  for (let i = 0; i < 3; i++) {
    const d = new Date(Date.UTC(2026, 5 - i, 1));
    const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2,'0')}`;
    store[`sentryTrend:${viewId}:${ym}`] = { viewId, yearMonth: ym, samples: [] };
  }
  await pruneOldSamples(viewId, '2026-06');
  const remaining = Object.keys(store).filter(k => k.startsWith(`sentryTrend:${viewId}:`));
  assert(remaining.length === 3, `expected 3, got ${remaining.length}`);
});

await testAsync('null viewId does nothing', async () => {
  resetStore();
  store['sentryTrend:x:2026-01'] = { viewId: 'x', yearMonth: '2026-01', samples: [] };
  await pruneOldSamples(null);
  assert(store['sentryTrend:x:2026-01'] !== undefined, 'should not have deleted anything');
});

// ─────────────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
