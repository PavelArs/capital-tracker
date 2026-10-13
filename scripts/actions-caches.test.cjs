const { test } = require('node:test');
const assert = require('node:assert/strict');
const { kindOf, familyOf, summarize, selectForSweep, listCaches, openRefsOf, deleteCaches } = require('./actions-caches.cjs');

const MIB = 1048576;
const now = Date.parse('2026-10-13T12:00:00Z');
const day = (n) => new Date(now - n * 86_400_000).toISOString();

let nextId = 1;
function cache(overrides = {}) {
  return {
    id: nextId++,
    ref: 'refs/heads/main',
    key: `node-cache-Linux-x64-pnpm-${'a'.repeat(64)}`,
    size_in_bytes: 100 * MIB,
    created_at: day(1),
    last_accessed_at: day(1),
    ...overrides,
  };
}

test('CACHE-001-A tells main, pull request merge refs and other branches apart', () => {
  assert.equal(kindOf('refs/heads/main'), 'main');
  assert.equal(kindOf('refs/pull/12/merge'), 'pull');
  assert.equal(kindOf('refs/heads/claude/some-branch'), 'branch');
});

test('CACHE-001-B groups keys that differ only by a hash or a version into one family', () => {
  assert.equal(familyOf(`node-cache-Linux-x64-pnpm-${'a'.repeat(64)}`), familyOf(`node-cache-Linux-x64-pnpm-${'b'.repeat(64)}`));
  assert.equal(familyOf('playwright-Linux-X64-1.60.0'), familyOf('playwright-Linux-X64-1.61.2'));
  assert.notEqual(familyOf('playwright-Linux-X64-1.60.0'), familyOf('node-cache-Linux-x64-pnpm-x'));
  assert.equal(familyOf('cache-trivy-2026-10-04'), familyOf('cache-trivy-2026-10-13'));
});

test('CACHE-001-C summarizes counts and sizes per kind and family', () => {
  const summary = summarize([
    cache(),
    cache({ ref: 'refs/pull/7/merge', size_in_bytes: 300 * MIB }),
    cache({ ref: 'refs/pull/8/merge', size_in_bytes: 200 * MIB }),
  ]);
  assert.equal(summary.count, 3);
  assert.equal(summary.bytes, 600 * MIB);
  assert.deepEqual(summary.groups.map((group) => [group.name.split(' ')[0], group.count, group.bytes / MIB]), [
    ['pull', 2, 500],
    ['main', 1, 100],
  ]);
});

test('CACHE-002-A the sweep removes caches of closed pull requests and branches, never main by that rule', () => {
  const open = cache({ ref: 'refs/pull/5/merge', key: 'k-open' });
  const closed = cache({ ref: 'refs/pull/4/merge', key: 'k-closed' });
  const branch = cache({ ref: 'refs/heads/claude/gone', key: 'k-branch' });
  const keptBranch = cache({ ref: 'refs/heads/claude/open', key: 'k-branch-open' });
  const main = cache({ key: 'k-main' });
  const plan = selectForSweep([open, closed, branch, keptBranch, main], {
    now,
    maxAgeDays: 5,
    openRefs: new Set(['refs/pull/5/merge', 'refs/heads/claude/open']),
  });
  assert.deepEqual(plan.selected.map((item) => item.id).sort(), [closed.id, branch.id].sort());
  assert.equal(plan.byRule['closed-ref'].count, 2);
});

test('CACHE-002-B only the newest copy of a family survives under one ref', () => {
  const oldest = cache({ created_at: day(9), last_accessed_at: day(1), key: `node-cache-Linux-x64-pnpm-${'1'.repeat(64)}` });
  const older = cache({ created_at: day(5), last_accessed_at: day(1), key: `node-cache-Linux-x64-pnpm-${'2'.repeat(64)}` });
  const newest = cache({ created_at: day(1), key: `node-cache-Linux-x64-pnpm-${'3'.repeat(64)}` });
  const otherRef = cache({ ref: 'refs/pull/5/merge', created_at: day(8), key: `node-cache-Linux-x64-pnpm-${'4'.repeat(64)}` });
  const plan = selectForSweep([oldest, older, newest, otherRef], { now, maxAgeDays: 30, openRefs: new Set(['refs/pull/5/merge']) });
  assert.deepEqual(plan.selected.map((item) => item.id).sort(), [oldest.id, older.id].sort());
  assert.equal(plan.byRule.superseded.count, 2);
});

test('CACHE-002-C a cache not used for the maximum age goes, a used one stays', () => {
  const stale = cache({ key: 'a-1.0.0', last_accessed_at: day(6) });
  const fresh = cache({ key: 'b-1.0.0', last_accessed_at: day(4) });
  const plan = selectForSweep([stale, fresh], { now, maxAgeDays: 5, openRefs: new Set() });
  assert.deepEqual(plan.selected.map((item) => item.id), [stale.id]);
  assert.equal(plan.byRule.stale.count, 1);
  assert.equal(plan.bytes, 100 * MIB);
});

test('CACHE-002-D a cache is counted once, under the first rule that matches', () => {
  const closedAndStale = cache({ ref: 'refs/pull/4/merge', last_accessed_at: day(20) });
  const plan = selectForSweep([closedAndStale], { now, maxAgeDays: 5, openRefs: new Set() });
  assert.equal(plan.count, 1);
  assert.deepEqual(Object.keys(plan.byRule), ['closed-ref']);
});

test('CACHE-003-A lists every page, opens refs from open pull requests and deletes by id', async () => {
  const calls = [];
  const page = (size) => Array.from({ length: size }, () => cache());
  const call = async (method, path) => {
    calls.push(`${method} ${path}`);
    if (path.includes('/actions/caches?') && path.endsWith('page=1')) return { actions_caches: page(100) };
    if (path.includes('/actions/caches?')) return { actions_caches: page(3) };
    if (path.includes('/pulls?')) {
      return [
        { number: 9, head: { ref: 'claude/x', repo: { full_name: 'o/r' } } },
        { number: 10, head: { ref: 'fork-branch', repo: { full_name: 'someone/else' } } },
      ];
    }
    return undefined;
  };
  assert.equal((await listCaches(call, 'o/r')).length, 103);
  const refs = await openRefsOf(call, 'o/r');
  assert.deepEqual([...refs].sort(), ['refs/heads/claude/x', 'refs/pull/10/merge', 'refs/pull/9/merge']);
  await deleteCaches(call, 'o/r', [{ id: 41 }, { id: 42 }]);
  assert.deepEqual(calls.slice(-2), ['DELETE repos/o/r/actions/caches/41', 'DELETE repos/o/r/actions/caches/42']);
});
