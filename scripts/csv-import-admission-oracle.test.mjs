import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertCsvReloadAdmission } from '../tests/e2e/csv-import-admission-oracle.ts';

const csrfHash = 'a'.repeat(64);
const initial = [
  {
    scope: 'csrf-ip',
    subjectHash: csrfHash,
    hits: 1,
    windowStartedAt: '2026-10-02T08:11:00.000Z',
    expiresAt: '2026-10-02T08:12:00.000Z',
    seconds: 60,
    live: true,
  },
  {
    scope: 'login-account',
    subjectHash: 'b'.repeat(64),
    hits: 1,
    windowStartedAt: '2026-10-02T08:11:00.000Z',
    expiresAt: '2026-10-02T08:21:00.000Z',
    seconds: 600,
    live: true,
  },
  {
    scope: 'login-ip',
    subjectHash: 'c'.repeat(64),
    hits: 1,
    windowStartedAt: '2026-10-02T08:10:40.500Z',
    expiresAt: '2026-10-02T08:11:40.500Z',
    seconds: 60,
    live: true,
  },
];

const eventStart = Date.parse('2026-10-02T08:11:40.000Z');
const eventEnd = Date.parse('2026-10-02T08:11:41.000Z');

function afterReload() {
  const rows = structuredClone(initial);
  rows[0].hits = 2;
  rows[2].live = false;
  return rows;
}

test('CSV reload accepts natural expiry only for an unchanged row', () => {
  assertCsvReloadAdmission(initial, afterReload(), csrfHash, eventStart, eventEnd);
});

test('CSV reload rejects a charged row that has expired', () => {
  const rows = afterReload();
  rows[0].live = false;
  assert.throws(() => assertCsvReloadAdmission(initial, rows, csrfHash, eventStart, eventEnd));
});

test('CSV reload rejects missing and extra admission rows', () => {
  assert.throws(() =>
    assertCsvReloadAdmission(initial, afterReload().slice(1), csrfHash, eventStart, eventEnd),
  );
  const rows = afterReload();
  rows.push({ ...rows[0], subjectHash: 'd'.repeat(64) });
  assert.throws(() => assertCsvReloadAdmission(initial, rows, csrfHash, eventStart, eventEnd));
});

test('CSV reload rejects hidden increments, fixed-window rollover and duration changes', () => {
  const hidden = afterReload();
  hidden[2].hits++;
  assert.throws(() => assertCsvReloadAdmission(initial, hidden, csrfHash, eventStart, eventEnd));

  const rollover = afterReload();
  rollover[0].windowStartedAt = '2026-10-02T08:12:00.000Z';
  rollover[0].expiresAt = '2026-10-02T08:13:00.000Z';
  assert.throws(() => assertCsvReloadAdmission(initial, rollover, csrfHash, eventStart, eventEnd));

  const duration = afterReload();
  duration[0].seconds = 120;
  assert.throws(() => assertCsvReloadAdmission(initial, duration, csrfHash, eventStart, eventEnd));
});

test('CSV reload accepts a new fixed CSRF window and pruning of only expired rows', () => {
  const rows = afterReload().slice(0, 2);
  rows[0].hits = 1;
  rows[0].windowStartedAt = '2026-10-02T08:12:20.000Z';
  rows[0].expiresAt = '2026-10-02T08:13:20.000Z';
  assertCsvReloadAdmission(
    initial,
    rows,
    csrfHash,
    Date.parse('2026-10-02T08:12:19.000Z'),
    Date.parse('2026-10-02T08:12:21.000Z'),
  );
});

test('CSV reload rejects a pruned live account row or a CSRF window outside event bounds', () => {
  const rows = afterReload().slice(0, 1);
  assert.throws(() => assertCsvReloadAdmission(initial, rows, csrfHash, eventStart, eventEnd));

  const rollover = afterReload();
  rollover[0].hits = 1;
  rollover[0].windowStartedAt = '2026-10-02T08:12:20.000Z';
  rollover[0].expiresAt = '2026-10-02T08:13:20.000Z';
  assert.throws(() =>
    assertCsvReloadAdmission(initial, rollover, csrfHash, eventStart, eventEnd),
  );

  const boundary = afterReload().slice(0, 2);
  assert.throws(() =>
    assertCsvReloadAdmission(
      initial,
      boundary,
      csrfHash,
      Date.parse('2026-10-02T08:11:40.000Z'),
      Date.parse('2026-10-02T08:11:41.000Z'),
    ),
  );
});
