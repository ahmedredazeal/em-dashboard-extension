#!/usr/bin/env node
/**
 * tests/jira-emails.test.js
 * JiraClient.getUserEmails aggregates only the emails Jira discloses, skipping
 * hidden (no emailAddress), errored, and null accountIds.
 */
import { JiraClient } from '../src/jira-api.js';
import assert from 'node:assert';

let pass = 0, fail = 0;
const test = (n, fn) => Promise.resolve().then(fn).then(() => { pass++; console.log(`  ✓ ${n}`); }, e => { fail++; console.log(`  ✗ ${n}\n    ${e.message}`); });

async function run() {
  await test('returns only disclosed emails; skips hidden / errored / null ids', async () => {
    const c = new JiraClient('https://x.atlassian.net', 'me@x.io', 'tok');
    c._get = async (path) => {
      if (path.includes('acc1')) return { accountId: 'acc1', emailAddress: 'a@x.io' };
      if (path.includes('acc2')) return { accountId: 'acc2' };          // hidden → no email
      if (path.includes('acc3')) throw new Error('404 not found');       // errored
      return {};
    };
    const emails = await c.getUserEmails(['acc1', 'acc2', 'acc3', null, '']);
    assert.deepStrictEqual(emails, { acc1: 'a@x.io' });
  });

  await test('empty / missing input is safe', async () => {
    const c = new JiraClient('https://x.atlassian.net', 'me@x.io', 'tok');
    c._get = async () => ({});
    assert.deepStrictEqual(await c.getUserEmails([]), {});
    assert.deepStrictEqual(await c.getUserEmails(null), {});
  });

  console.log(`\njira-emails: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
run();
