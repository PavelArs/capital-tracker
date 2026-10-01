import { describe, expect, it } from 'vitest';
import { toDisplayFxView } from './display-fx-view';

const report = {
  amountUsd: '123.45',
  enabled: true,
  source: 'exchangerate-api-open',
  kind: 'indicative-daily',
  basis: 'latest-stored-observation',
  status: 'fresh',
  observation: {
    observedAt: '2025-01-04T00:06:37.000Z',
    fetchedAt: '2025-01-04T00:08:00.000Z',
    nextUpdateAt: '2025-01-05T00:06:37.000Z',
    endOfLifeAt: null,
    eurRate: '0.9',
    rubRate: '90.12',
    eurAmount: '111.105',
    rubAmount: '11125.314',
  },
  collection: {
    lastAttemptAt: '2025-01-04T00:08:00.000Z',
    lastSuccessAt: '2025-01-04T00:08:00.000Z',
    nextAttemptAt: '2025-01-05T00:08:00.000Z',
    outcome: 'ok',
    inProgress: false,
  },
} as const;

describe('stored daily FX presentation', () => {
  it('preserves exact server strings in the two indicative currency rows', () => {
    expect(toDisplayFxView(report).rows).toEqual([
      { currency: 'EUR', rate: '0.9', amount: '111.105' },
      { currency: 'RUB', rate: '90.12', amount: '11125.314' },
    ]);
  });

  it('keeps a failed collection distinct from unavailable data and retains the last good values', () => {
    const stale = {
      ...report,
      status: 'stale',
      collection: { ...report.collection, outcome: 'rate-limited' },
    } as const;
    const view = toDisplayFxView(stale);
    expect(view.statusText).toBe('Данные устарели');
    expect(view.rows).toEqual(toDisplayFxView(report).rows);
    expect(view.canCollect).toBe(true);
    const unavailable = {
      ...report,
      status: 'unavailable',
      observation: null,
      collection: { ...report.collection, outcome: 'provider-error' },
    } as const;
    expect(toDisplayFxView(unavailable)).toMatchObject({
      statusText: 'Нет сохранённых курсов',
      rows: [],
    });
  });

  it('treats saved zero conversion as known and the disabled flag independently from freshness', () => {
    const zero = {
      ...report,
      amountUsd: '0',
      enabled: false,
      observation: { ...report.observation, eurAmount: '0', rubAmount: '0' },
    } as const;
    const view = toDisplayFxView(zero);
    expect(view.rows.map((row) => row.amount)).toEqual(['0', '0']);
    expect(view.statusText).toBe('Сохранённые курсы актуальны');
    expect(view.canCollect).toBe(false);
  });
});
