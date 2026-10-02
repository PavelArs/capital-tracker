import assert from 'node:assert/strict';
import type { LedgerRow } from './admission-fixtures';

// The CSV journey can cross a 60-second boundary while taking screenshots and
// restarting the backend. Its one post-reload CSRF request is the only allowed
// admission after the first live-window checkpoint.
export function assertCsvReloadAdmission(
  before: LedgerRow[],
  after: LedgerRow[],
  csrfHash: string,
  eventStartMs: number,
  eventEndMs: number,
): void {
  assert(Number.isFinite(eventStartMs) && Number.isFinite(eventEndMs));
  assert(eventStartMs <= eventEndMs);
  const key = (row: LedgerRow) => `${row.scope}:${row.subjectHash}`;
  const earlier = new Map(before.map((row) => [key(row), row]));
  const later = new Map(after.map((row) => [key(row), row]));
  assert.equal(earlier.size, before.length, 'Initial admission subjects must be unique');
  assert.equal(later.size, after.length, 'Reload admission subjects must be unique');

  const csrfKey = `csrf-ip:${csrfHash}`;
  const oldCsrf = earlier.get(csrfKey);
  const newCsrf = later.get(csrfKey);
  assert(oldCsrf && newCsrf, 'The browser CSRF subject must remain present');

  for (const row of after) {
    const previous = earlier.get(key(row));
    assert(previous, `Unexpected admission subject ${row.scope}`);
    const seconds = row.scope === 'login-account' ? 600 : 60;
    assert.equal(row.seconds, seconds, `Fixed ${row.scope} window duration changed`);
    assert.equal(
      Date.parse(row.expiresAt) - Date.parse(row.windowStartedAt),
      seconds * 1000,
      `Fixed ${row.scope} window timestamps changed duration`,
    );
    if (key(row) !== csrfKey) {
      assert.deepEqual(
        { ...row, live: previous.live },
        previous,
        `Unrelated ${row.scope} admission changed during CSV reload`,
      );
      continue;
    }

    const sameWindow = row.windowStartedAt === previous.windowStartedAt;
    if (sameWindow) {
      assert.equal(row.expiresAt, previous.expiresAt);
      assert.equal(row.hits, previous.hits + 1, 'Exactly one CSRF hit is charged');
      assert(eventStartMs < Date.parse(row.expiresAt), 'Expired CSRF window cannot be reused');
    } else {
      assert.equal(row.hits, 1, 'A new CSRF window starts with one hit');
      assert(
        Date.parse(row.windowStartedAt) >= Date.parse(previous.expiresAt),
        'CSRF window cannot roll over early',
      );
      assert(
        Date.parse(row.windowStartedAt) >= eventStartMs &&
          Date.parse(row.windowStartedAt) <= eventEndMs,
        'New CSRF window must start during the observed reupload',
      );
    }
    assert(
      row.live || Date.parse(row.expiresAt) <= eventEndMs,
      'The charged CSRF window must be live unless it expired after admission',
    );
  }

  for (const row of before) {
    if (later.has(key(row))) continue;
    assert.notEqual(key(row), csrfKey);
    assert(
      Date.parse(row.expiresAt) <= eventStartMs,
      `Only an admission expired before reupload may be pruned: ${row.scope}`,
    );
  }
}
