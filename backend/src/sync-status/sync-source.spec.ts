import { recordSource } from './sync-source';

describe('recordSource', () => {
  const at = new Date('2026-10-30T09:00:00Z');
  const stored = (query: jest.Mock) => query.mock.calls[0][1][6];

  it('cuts a long failure text to the 300 characters sync_sources."errorMessage" holds', async () => {
    // About 50 unlisted Bybit codes make a message far longer than the column.
    const codes = Array.from({ length: 50 }, (_, i) => `SYNTHETICCOIN${i}`).join(', ');
    const message = `Bybit has no USDT market for ${codes}`;
    const query = jest.fn().mockResolvedValue(undefined);
    await recordSource(
      { query },
      'prices:bybit',
      { state: 'delayed', errorCode: 'missing_assets', errorMessage: message, nextRunAt: null },
      at,
    );
    expect(message.length).toBeGreaterThan(300);
    expect(stored(query)).toBe(message.slice(0, 300));
  });

  it('keeps an absent failure text absent', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await recordSource(
      { query },
      'prices:bybit',
      { state: 'synced', errorCode: null, errorMessage: null, nextRunAt: null },
      at,
    );
    expect(stored(query)).toBeNull();
  });
});
