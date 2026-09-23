'use strict';

// Run inside the pinned acceptance backend image; no database or provider access.
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { projectXirr } = require('/app/backend/dist/accounting/xirr.js');
const from = '1970-01-01T00:00:00.000Z';
const to = '9999-12-31T23:59:59.999Z';
const first = BigInt(Date.parse(from));
const last = BigInt(Date.parse(to));
const items = Array.from({ length: 63 }, (_, index) => ({
  flowId: `benchmark-${index}`,
  requestId: `benchmark-${index}`,
  version: 1,
  journalRevision: index + 1,
  createdAt: from,
  amountUsd: '1',
  occurredAt: new Date(Number(first + (last - first) * BigInt(index) / 63n)).toISOString(),
  direction: 'contribution',
  kind: 'create',
}));

async function main() {
  let timerTicks = 0;
  const timer = setInterval(() => timerTicks++, 1);
  const start = performance.now();
  try {
    const result = await projectXirr({ from, to, openingValueUsd: '0', closingValueUsd: '100', assertReviewed: true }, items);
    assert.equal(result.status, 'available');
    assert.equal(result.cashFlowDateCount, 64);
    assert.equal(result.shortPeriod, false);
    assert.ok(timerTicks > 0, 'Other event-loop timers progress during the real computation');
    console.log(JSON.stringify({ node: process.version, elapsedMs: Math.round(performance.now() - start), timerTicks, result }));
  } finally {
    clearInterval(timer);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
