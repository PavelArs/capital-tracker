import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import {
  ETHERSCAN_PAGE_SIZE,
  type Failed,
  parseInternal,
  parseNormal,
  parseToken,
} from './etherscan-client';
import type { EvmReader, EvmSource } from './evm-reader';
import { jsonbText } from './jsonb-text';

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

/** An item's identity within its list; null when the provider gives no index for it. */
function itemIdentity(kind: Kind, raw: Record<string, unknown>): string | null {
  const hash = String(raw.hash ?? raw.transactionHash).toLowerCase();
  if (kind === 'normal') return hash;
  const index = kind === 'internal' ? raw.traceId : raw.logIndex;
  // Missing indices can represent legitimate identical transfers; never deduplicate by amount.
  return index === undefined ? null : `${hash}:${String(index)}`;
}

/** Whether a page repeats an item the block already staged, or one of its own. */
function repeatsItem(
  kind: Kind,
  staged: readonly Record<string, unknown>[],
  items: readonly { raw: Record<string, unknown> }[],
): boolean {
  const seen = new Set(staged.map((raw) => itemIdentity(kind, raw)).filter((key) => key !== null));
  for (const item of items) {
    const key = itemIdentity(kind, item.raw);
    if (key !== null && seen.has(key)) return true;
    if (key !== null) seen.add(key);
  }
  return false;
}

/**
 * A primary page that the plan refuses, or that gets no answer once the reader has settled
 * on the fallback, moves the block there. A staged block pins its source, so one missed
 * page alone is a retry on that source, not a move.
 */
function movesToFallback(reason: Failed['reason'], reader: EvmReader, source: EvmSource): boolean {
  const moved =
    reason === 'plan_required' || (reason === 'unavailable' && reader.historySource === 'fallback');
  return moved && source === 'primary' && reader.fallbackAvailable;
}

/** The block a history or token pass reads next. */
function nextBlock(state: EvmScan, mode: EvmBlockProgress['mode']): number {
  return (mode === 'history' ? (state.scannedBlock ?? -1) : (state.tokenBackfillAt ?? -1)) + 1;
}

/** The block's staged progress, else a fresh one; progress staged for another block conflicts. */
function startProgress(
  state: EvmScan,
  mode: EvmBlockProgress['mode'],
  block: number,
  reader: EvmReader,
): EvmBlockProgress {
  const progress: EvmBlockProgress = state.evmSync ?? {
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
  return progress;
}

/** The progress with one more page of `kind`; a page short of full ends that list. */
function withPage(
  progress: EvmBlockProgress,
  kind: Kind,
  items: readonly { raw: Record<string, unknown> }[],
): EvmBlockProgress {
  const done = items.length < ETHERSCAN_PAGE_SIZE;
  return {
    ...progress,
    revision: randomUUID(),
    [kind]: [...progress[kind], ...items.map((item) => item.raw)],
    kind: progress.kind + (done ? 1 : 0),
    page: done ? 1 : progress.page + 1,
  };
}

/** Store the block's staged pages, unless another sync changed the address since `expected`. */
function stageProgress(
  source: DataSource,
  expected: EvmScan,
  next: EvmBlockProgress,
): Promise<EvmScan> {
  return source.transaction('READ COMMITTED', async (manager) => {
    const [current]: EvmScan[] = await manager.query(
      `SELECT id, "ownerId", address, "scannedBlock", "tokenBackfillTo", "tokenBackfillAt", "evmSync"
          FROM wallet_addresses WHERE "ownerId" = $1 AND id = $2 AND "removedAt" IS NULL FOR UPDATE`,
      [expected.ownerId, expected.id],
    );
    if (!sameEvmScan(current, expected))
      throw new ConflictException('Another sync advanced this address');
    await manager.query(
      'UPDATE wallet_addresses SET "evmSync" = $3::jsonb WHERE "ownerId" = $1 AND id = $2',
      [expected.ownerId, expected.id, jsonbText(next)],
    );
    return { ...current, evmSync: next };
  });
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
  const block = nextBlock(state, mode);
  let progress = startProgress(state, mode, block, reader);
  const kinds: Kind[] = mode === 'tokens' ? ['tokens'] : ['normal', 'internal', 'tokens'];
  const save = async (next: EvmBlockProgress) => {
    state = await stageProgress(source, state, next);
    progress = next;
  };
  if (!state.evmSync) await save(progress);
  for (let requests = 0; progress.kind < kinds.length; requests++) {
    if (requests >= 10 || Date.now() - started > 25_000)
      return { ok: true as const, complete: false as const, state };
    const kind = kinds[progress.kind];
    const read = await reader.page(progress.source, kind, state.address, block, progress.page);
    if (!read.ok) {
      if (!movesToFallback(read.reason, reader, progress.source)) return read;
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
    if (
      read.items.some((item) => item.blockNumber !== block) ||
      repeatsItem(kind, progress[kind], read.items)
    )
      return { ok: false as const, reason: 'invalid_response' as const };
    await save(withPage(progress, kind, read.items));
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
