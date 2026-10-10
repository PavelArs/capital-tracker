import type { EtherscanClient } from './etherscan-client';
import { EvmReader, FALLBACK_FOR_MS } from './evm-reader';

// Synthetic clients: each answers the calls the reader forwards and counts them.
const planRequired = { ok: false, reason: 'plan_required' } as const;
const fake = (answers: unknown[]) => {
  const calls: string[] = [];
  const client = {
    configured: true,
    normal: async () => {
      calls.push('normal');
      return answers.shift();
    },
    blockNumber: async () => {
      calls.push('blockNumber');
      return answers.shift();
    },
  };
  return { client: client as unknown as EtherscanClient, calls };
};

describe('BLOCKSCOUT fallback reader', () => {
  it('uses the primary source alone when no fallback exists, refusals included', async () => {
    const primary = fake([planRequired]);
    const reader = new EvmReader(primary.client, null);
    await expect(reader.normal('0x', 1, 2)).resolves.toEqual(planRequired);
    expect(primary.calls).toEqual(['normal']);
  });

  it('keeps to the primary source while it answers', async () => {
    const primary = fake([{ ok: true, items: [] }]);
    const fallback = fake([]);
    const reader = new EvmReader(primary.client, fallback.client);
    await expect(reader.normal('0x', 1, 2)).resolves.toEqual({ ok: true, items: [] });
    expect(fallback.calls).toEqual([]);
  });

  it('turns to the fallback when the plan refuses, and stays there until the hold ends', async () => {
    let now = 1_000;
    const primary = fake([planRequired, { ok: true, block: 5 }]);
    const fallback = fake([
      { ok: true, block: 1 },
      { ok: true, block: 2 },
    ]);
    const reader = new EvmReader(primary.client, fallback.client, () => now);
    await expect(reader.blockNumber()).resolves.toEqual({ ok: true, block: 1 });
    now += FALLBACK_FOR_MS - 1;
    await expect(reader.blockNumber()).resolves.toEqual({ ok: true, block: 2 });
    expect(primary.calls).toEqual(['blockNumber']);
    now += 2;
    await expect(reader.blockNumber()).resolves.toEqual({ ok: true, block: 5 });
    expect(primary.calls).toEqual(['blockNumber', 'blockNumber']);
  });

  it('does not turn to the fallback for any other refusal', async () => {
    const primary = fake([{ ok: false, reason: 'rate_limited' }]);
    const fallback = fake([]);
    const reader = new EvmReader(primary.client, fallback.client);
    await expect(reader.normal('0x', 1, 2)).resolves.toEqual({ ok: false, reason: 'rate_limited' });
    expect(fallback.calls).toEqual([]);
  });

  it('reports what the fallback says when it fails too', async () => {
    const primary = fake([planRequired]);
    const fallback = fake([{ ok: false, reason: 'unavailable' }]);
    const reader = new EvmReader(primary.client, fallback.client);
    await expect(reader.normal('0x', 1, 2)).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });
});
