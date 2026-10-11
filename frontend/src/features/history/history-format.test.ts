import type { AuditEvent, AuditField } from '@api/audit-history.api';
import { describe, expect, it } from 'vitest';
import { fieldText, glyphOf, summary, valueText } from './history-format';

const usd = (value: string) => ({ kind: 'usd' as const, value, unit: null });
const btc = (value: string) => ({ kind: 'quantity' as const, value, unit: 'BTC' });
const text = (value: string) => ({ kind: 'text' as const, value, unit: null });

function event(overrides: Partial<AuditEvent>): AuditEvent {
  return {
    id: 'trade:1:000001',
    at: '2026-10-09T12:30:00.000Z',
    entity: 'trade',
    entityId: '1',
    version: 1,
    change: 'created',
    actor: 'owner',
    title: 'Buy BTC',
    asset: 'BTC',
    account: 'Bybit',
    occurredAt: '2026-10-01T00:00:00.000Z',
    fields: [],
    ...overrides,
  };
}

describe('valueText', () => {
  it('reads each kind of stored value the way the rest of the app does', () => {
    expect(valueText(btc('0.5'))).toBe('0.5 BTC');
    expect(valueText(usd('30000'))).toBe('$30,000.00');
    expect(valueText(text('Staking'))).toBe('Staking');
    expect(valueText({ kind: 'moment', value: '2026-10-01T00:00:00.000Z', unit: null })).toBe(
      'Oct 1, 2026, 00:00 UTC',
    );
    expect(valueText({ kind: 'quantity', value: '5', unit: null })).toBe('5');
  });
});

describe('fieldText', () => {
  it('shows both values of a change and the single value of a created or removed field', () => {
    const changed: AuditField = { label: 'Amount', before: usd('30000'), after: usd('31000') };
    expect(fieldText(changed)).toBe('Amount: $30,000.00 → $31,000.00');
    expect(fieldText({ label: 'Comment', before: null, after: text('Fixed') })).toBe(
      'Comment: Fixed',
    );
    expect(fieldText({ label: 'Comment', before: text('Old'), after: null })).toBe('Comment: Old');
  });
});

describe('summary', () => {
  it('leads with the first change and counts the rest', () => {
    const fields: AuditField[] = [
      { label: 'Amount', before: usd('30000'), after: usd('31000') },
      { label: 'Comment', before: null, after: text('Fixed') },
      { label: 'Fee', before: usd('0'), after: usd('1') },
    ];
    expect(summary(event({ change: 'changed', fields }))).toBe(
      'Amount: $30,000.00 → $31,000.00 +2 more',
    );
    expect(summary(event({ change: 'changed', fields: fields.slice(0, 1) }))).toBe(
      'Amount: $30,000.00 → $31,000.00',
    );
  });

  it('says so when a version differs in nothing the screen shows', () => {
    expect(summary(event({ change: 'changed', fields: [] }))).toBe('No visible field changed');
  });

  it('names the main facts of a created entry, not its date or comment', () => {
    const fields: AuditField[] = [
      { label: 'Side', before: null, after: text('Buy') },
      { label: 'Quantity', before: null, after: btc('0.5') },
      { label: 'Amount', before: null, after: usd('30000') },
      { label: 'Date', before: null, after: { kind: 'moment', value: 'x', unit: null } },
    ];
    expect(summary(event({ fields }))).toBe('Side Buy · Quantity 0.5 BTC');
    expect(summary(event({ fields: [] }))).toBe('Recorded');
  });

  it('names what a deletion removed', () => {
    const fields: AuditField[] = [
      { label: 'Quantity', before: btc('0.5'), after: null },
      { label: 'Amount', before: usd('40000'), after: null },
    ];
    expect(summary(event({ change: 'deleted', fields }))).toBe(
      'Quantity 0.5 BTC · Amount $40,000.00',
    );
    expect(summary(event({ change: 'deleted', fields: [] }))).toBe('Removed from calculations');
  });
});

describe('glyphOf', () => {
  it('marks each kind of entry', () => {
    expect(glyphOf(event({ entity: 'trade', title: 'Buy BTC' }))).toBe('buy');
    expect(glyphOf(event({ entity: 'trade', title: 'Sell BTC' }))).toBe('sell');
    expect(glyphOf(event({ entity: 'transfer' }))).toBe('move');
    expect(glyphOf(event({ entity: 'swap' }))).toBe('move');
    expect(glyphOf(event({ entity: 'reward' }))).toBe('reward');
    expect(glyphOf(event({ entity: 'flow', title: 'Deposit' }))).toBe('in');
    expect(glyphOf(event({ entity: 'flow', title: 'Withdrawal' }))).toBe('out');
    expect(glyphOf(event({ entity: 'price' }))).toBe('opening');
    expect(glyphOf(event({ entity: 'classification' }))).toBe('chain');
  });
});
