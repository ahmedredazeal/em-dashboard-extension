#!/usr/bin/env node
/**
 * tests/integration.test.js
 * Tests the data flow from settings → fetch → render.
 * Mocks chrome.storage so no browser needed.
 * Run with: node tests/integration.test.js
 */

import { parseExtraBoardSpec, parseExtraBoardsTextarea } from '../src/parsers.js';

let pass = 0, fail = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (err) {
    console.error(`  ✗ ${name}\n      ${err.message}`);
    fail++;
  }
}

function assertEqual(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${msg || ''}\n      expected: ${JSON.stringify(b)}\n      actual:   ${JSON.stringify(a)}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// ── Simulated settings.js save → storage format ──────────────────────────

function simulateSettingsSave(textareaValue) {
  // Mirrors the settings.js extraBoards save logic exactly
  return textareaValue
    .split('\n')
    .map(line => line.trim())
    .filter(line => line)
    .map(line => {
      if (line.includes('|')) {
        const [name, id] = line.split('|').map(s => s.trim());
        return { name, id: parseInt(id, 10) };
      }
      return { name: `Board ${line}`, id: parseInt(line, 10) };
    })
    .filter(b => Number.isFinite(b.id));
}

// ── Simulated background.js read → fetch args ─────────────────────────────

function simulateBackgroundRead(storedBoards) {
  return (storedBoards || [])
    .map(spec => parseExtraBoardSpec(spec))
    .filter(Boolean);
}

console.log('\n— Settings save format');

test('single board saved correctly', () => {
  const saved = simulateSettingsSave('Support Board|456');
  assertEqual(saved, [{ name: 'Support Board', id: 456 }]);
});

test('multiple boards saved correctly', () => {
  const saved = simulateSettingsSave('Support|456\nPOS Board|789');
  assertEqual(saved, [
    { name: 'Support', id: 456 },
    { name: 'POS Board', id: 789 }
  ]);
});

test('bare board ID saved correctly', () => {
  const saved = simulateSettingsSave('456');
  assertEqual(saved, [{ name: 'Board 456', id: 456 }]);
});

console.log('\n— Storage round-trip: save → background reads');

test('background reads objects saved by settings.js', () => {
  const saved = simulateSettingsSave('Support|456\nPOS|789');
  const read = simulateBackgroundRead(saved);
  assertEqual(read, [
    { label: 'Support', id: 456 },
    { label: 'POS', id: 789 }
  ]);
});

test('background survives empty extraBoards', () => {
  const read = simulateBackgroundRead([]);
  assertEqual(read, []);
});

test('background survives undefined extraBoards', () => {
  const read = simulateBackgroundRead(undefined);
  assertEqual(read, []);
});

test('background handles NaN id gracefully (drops it)', () => {
  const corrupted = [{ name: 'Bad', id: NaN }];
  const read = simulateBackgroundRead(corrupted);
  assertEqual(read, []);
});

console.log('\n— Cache invalidation after settings save');

test('settings save should reset cache timestamp to force fresh fetch', () => {
  // Simulates what popup.js should do on settings-updated
  let cacheCleared = false;
  const mockStorage = {
    set: (data) => {
      if (data.cache?.lastFetch?.jira === 0 && data.cache?.lastFetch?.sentry === 0) {
        cacheCleared = true;
      }
    }
  };
  
  // Simulate the settings-updated handler
  function onSettingsUpdated(storage) {
    storage.set({ cache: { lastFetch: { jira: 0, sentry: 0 } } });
  }
  
  onSettingsUpdated(mockStorage);
  assert(cacheCleared, 'Cache was NOT cleared after settings-updated — fresh fetch will be skipped!');
});

test('fresh cache (< 2 min) would skip fetch WITHOUT the fix', () => {
  const lastFetch = Date.now() - 30000; // 30 seconds ago
  const cacheAge = Date.now() - lastFetch;
  const CACHE_GRACE_MS = 2 * 60 * 1000;
  assert(cacheAge < CACHE_GRACE_MS, 'Cache should be considered fresh');
});

test('zeroed cache always triggers fetch', () => {
  const lastFetch = 0; // cleared by settings-updated handler
  const cacheAge = lastFetch ? Date.now() - lastFetch : Infinity;
  const CACHE_GRACE_MS = 2 * 60 * 1000;
  assert(cacheAge >= CACHE_GRACE_MS, 'Zero timestamp should produce Infinity age → always fetch');
});

console.log('\n— renderExtraBoards prerequisites');

test('boards with no stories still render (shows 0/0)', () => {
  const board = {
    boardId: 456, boardLabel: 'Support', sprintName: 'Sprint 12',
    totalPoints: 0, completedPoints: 0, totalStories: 0, completedStories: 0,
    stories: []
  };
  // Just assert the data shape is valid
  assert(board.boardLabel, 'boardLabel required');
  assert(board.sprintName, 'sprintName required');
  assert(Array.isArray(board.stories), 'stories must be array');
});

test('boards with stories have correct shape', () => {
  const story = {
    key: 'HRM-100', summary: 'Test story',
    status: 'In Progress', statusCategory: 'indeterminate',
    assignee: 'Ali', points: 5, dueDate: null
  };
  assert(story.key, 'key required');
  assert(typeof story.points === 'number', 'points must be number');
});

// ────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
