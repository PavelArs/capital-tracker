import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { ETHERSCAN_PAGE_SIZE, parseInternal, parseNormal, parseToken } from './etherscan-client';
import type { EvmReader, EvmSource } from './evm-reader';

type Kind = 'normal' | 'internal' | 'tokens';
export interface EvmBlockProgress {
  revision: string;
  mode: 'history' | 'tokens';
  block: number;
  source: EvmSource;
  kind: number;
  page: number;
  normal: Record<string, unknown>[];
  internal: Record<string, unknown>[];
  tokens: Record<string, unknown>[];
}
export interface EvmScan {
  id: string;
  ownerId: string;
  address: string;
  scannedBlock: number | null;
  tokenBackfillTo: number | null;
  tokenBackfillAt: number | null;
  evmSync: EvmBlockProgress | null;
}

export function sameEvmScan(current: EvmScan | undefined, expected: EvmScan): boolean {
  return (
    !!current &&
    current.scannedBlock === expected.scannedBlock &&
    current.tokenBackfillTo === expected.tokenBackfillTo &&
    current.tokenBackfillAt === expected.tokenBackfillAt &&
    (current.evmSync?.revision ?? null) === (expected.evmSync?.revision ?? null)
  );
}

/** Stage a whole saturated block: page-local leg conversion would change transaction identities. */
export async function readEvmBlock(
  source: DataSource,
  reader: EvmReader,
  initial: EvmScan,
  mode: EvmBlockProgress['mode'],
  started: number,
) {
  let state = initial;
  const block =
    (mode === 'history' ? (state.scannedBlock ?? -1) : (state.tokenBackfillAt ?? -1)) + 1;
  let progress: EvmBlockProgress = state.evmSync ?? {
    revision: randomUUID(),
    mode,
    block,
    source: reader.historySource,
    kind: 0,
    page: 1,
    normal: [],
    internal: [],
    tokens: [],
  };
  if (progress.block !== block || progress.mode !== mode)
    throw new ConflictException('Another sync changed this address');
  const kinds: Kind[] = mode === 'tokens' ? ['tokens'] : ['normal', 'internal', 'tokens'];
  const save = async (next: EvmBlockProgress) => {
    const expected = state;
    state = await source.transaction('READ COMMITTED', async (manager) => {
      const [current]: EvmScan[] = await manager.query(
        `SELECT id, "ownerId", address, "scannedBlock", "tokenBackfillTo", "tokenBackfillAt", "evmSync"
          FROM wallet_addresses WHERE "ownerId" = $1 AND id = $2 AND "removedAt" IS NULL FOR UPDATE`,
        [expected.ownerId, expected.id],
      );
      if (!sameEvmScan(current, expected))
        throw new ConflictException('Another sync advanced this address');
      await manager.query(
        'UPDATE wallet_addresses SET "evmSync" = $3::jsonb WHERE "ownerId" = $1 AND id = $2',
        [expected.ownerId, expected.id, JSON.stringify(next)],
      );
      return { ...current, evmSync: next };
    });
    progress = next;
  };
  if (!state.evmSync) await save(progress);
  for (let requests = 0; progress.kind < kinds.length; requests++) {
    if (requests >= 10 || Date.now() - started > 25_000)
      return { ok: true as const, complete: false as const, state };
    const kind = kinds[progress.kind];
    const read = await reader.page(progress.source, kind, state.address, block, progress.page);
    if (!read.ok) {
      if (
        read.reason === 'plan_required' &&
        progress.source === 'primary' &&
        reader.fallbackAvailable
      ) {
        // Restart the uncommitted block; provider-specific ordering must never mix.
        await save({
          ...progress,
          revision: randomUUID(),
          source: 'fallback',
          kind: 0,
          page: 1,
          normal: [],
          internal: [],
          tokens: [],
        });
        continue;
      }
      return read;
    }
    if (read.items.some((item) => item.blockNumber !== block))
      return { ok: false as const, reason: 'invalid_response' as const };
    const identity = (raw: Record<string, unknown>): string | null => {
      const hash = String(raw.hash ?? raw.transactionHash).toLowerCase();
      if (kind === 'normal') return hash;
      const index = kind === 'internal' ? raw.traceId : raw.logIndex;
      // Missing indices can represent legitimate identical transfers; never deduplicate by amount.
      return index === undefined ? null : `${hash}:${String(index)}`;
    };
    const seen = new Set(progress[kind].map(identity).filter((key) => key !== null));
    for (const item of read.items) {
      const key = identity(item.raw);
      if (key !== null && seen.has(key))
        return { ok: false as const, reason: 'invalid_response' as const };
      if (key !== null) seen.add(key);
    }
    const done = read.items.length < ETHERSCAN_PAGE_SIZE;
    await save({
      ...progress,
      revision: randomUUID(),
      [kind]: [...progress[kind], ...read.items.map((item) => item.raw)],
      kind: progress.kind + (done ? 1 : 0),
      page: done ? 1 : progress.page + 1,
    });
  }
  return {
    ok: true as const,
    complete: true as const,
    state,
    end: block,
    normal: progress.normal.map(parseNormal),
    internal: progress.internal.map(parseInternal),
    tokens: progress.tokens.map(parseToken),
  };
}
