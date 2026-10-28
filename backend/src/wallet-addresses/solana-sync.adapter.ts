import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { ChainSyncAdapter, StepFailure, StepResult } from './chain-sync';
import { countableLegs, registerChainTokens, type TokenFacts } from './chain-tokens';
import { type SolanaLeg, solanaLegs, solanaTokenFacts } from './solana-legs';
import {
  parseTransaction,
  type SignatureInfo,
  SOLANA_ACCOUNTS_PER_CALL,
  SOLANA_SIGNATURE_PAGE_SIZE,
  SolanaRpcClient,
  type SolanaTransaction,
} from './solana-rpc-client';
import {
  parseStakeAccount,
  STAKE_PROGRAM,
  type StakeAccountState,
  type StakeActivity,
  stakeActivity,
} from './solana-stake';
import {
  metadataAddress,
  parseMetadata,
  parseMint,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
  WRAPPED_SOL,
} from './solana-token-metadata';

// Bounds for one pass; the next pass continues from the committed slot.
export const MAX_TRANSACTIONS_PER_SYNC = 40;
// Signature pages across every address in one pass: at most 50 000 signatures.
export const MAX_SIGNATURE_PAGES = 50;
const SYNC_TIME_BUDGET_MS = 25_000;
// Stored transactions read per query when an address's history is first read for stake.
const STAKE_BACKFILL_PAGE = 200;
// Mints whose accounts one getMultipleAccounts call reads: each with its metadata account.
const MINTS_PER_CALL = SOLANA_ACCOUNTS_PER_CALL / 2;

interface ScanRow {
  id: string;
  ownerId: string;
  address: string;
  scannedBlock: number | null;
  /** TOKEN-BACKFILL: the last slot of the history stored before every token was read. */
  tokenBackfillTo: number | null;
  /** TOKEN-BACKFILL: -1 once the stored transactions were read again; then the last slot whose
   * transactions of the token accounts are read. Null before either. */
  tokenBackfillAt: number | null;
  solanaSync: SyncProgress | null;
}

interface SyncProgress {
  revision: string;
  mode: 'ordinary' | 'backfill';
  phase: 'stored' | 'discover' | 'ingest';
  target: number;
  accounts: string[];
  accountIndex: number;
  before: string | null;
  signatures: SignatureInfo[];
  position: number;
  staged: { signature: string; raw: Record<string, unknown> }[];
  storedAfter: string;
}

const scanColumns = `id, "ownerId", address, "scannedBlock", "tokenBackfillTo", "tokenBackfillAt", "solanaSync"`;
type Named = { ok: true; facts: TokenFacts[] } | { ok: false; reason: StepFailure };

/** One transaction's effect on the wallet's stake accounts (SOL-STAKE-MOVE). */
interface StakeRecord {
  signature: string;
  slot: number;
  blockTime: string;
  activity: StakeActivity;
}

function stakeRecord(address: string, tx: SolanaTransaction): StakeRecord | null {
  const activity = stakeActivity(address, tx);
  if (activity.accounts.length === 0) return null;
  return {
    signature: tx.signature,
    slot: tx.slot,
    blockTime: new Date(tx.blockTime * 1000).toISOString(),
    activity,
  };
}

/**
 * Solana history from public JSON-RPC. A wallet's signatures do not include tokens sent to its
 * token accounts, so the signatures of each USDT and USDC account it owns are read too. Every
 * finalized signature newer than the stored slot is fetched oldest first, and whole slots are
 * committed with the cursor, so an interrupted pass resumes without gaps or duplicates.
 */
@Injectable()
export class SolanaSyncAdapter implements ChainSyncAdapter {
  readonly network = 'solana';
  readonly name = 'Solana';

  constructor(
    private readonly source: DataSource,
    private readonly rpc: SolanaRpcClient,
  ) {}

  async step(ownerId: string, addressId: string): Promise<StepResult> {
    let state = await this.scan(ownerId, addressId);
    await this.backfillStake(state);
    let imported = 0;
    const failed = (reason: StepFailure): StepResult => ({
      outcome: 'provider_error',
      reason,
      imported,
    });
    // The finalized slot first: every slot up to it is final in each list read below.
    const tip = await this.rpc.slot();
    if (!tip.ok) return failed(tip.reason);
    const started = Date.now();
    let fetched = 0;
    let pages = 0;
    const partial = (): StepResult => ({ outcome: 'partial', reason: null, imported });
    for (;;) {
      let progress = state.solanaSync;
      if (!progress) {
        const mode = state.tokenBackfillTo === null ? 'ordinary' : 'backfill';
        const target = mode === 'ordinary' ? tip.slot : (state.tokenBackfillTo as number);
        const after =
          mode === 'ordinary' ? (state.scannedBlock ?? -1) : (state.tokenBackfillAt ?? -1);
        if (mode === 'ordinary' && after >= target) {
          const committed = await this.commit(state, [], [], [], after, true, null);
          state = committed.state;
          const stake = await this.refreshStake(state, target);
          return stake ? failed(stake) : { outcome: 'complete', reason: null, imported };
        }
        if (Date.now() - started >= SYNC_TIME_BUDGET_MS) return partial();
        const found = await this.tokenAccounts(state.address);
        if (!found.ok) return failed(found.reason);
        progress = {
          revision: randomUUID(),
          mode,
          phase: mode === 'backfill' && state.tokenBackfillAt === null ? 'stored' : 'discover',
          target,
          accounts: [...found.accounts],
          accountIndex: 0,
          before: null,
          signatures: [],
          position: 0,
          staged: [],
          storedAfter: '',
        };
        state = await this.checkpoint(state, progress);
        progress = state.solanaSync as SyncProgress;
      }
      const accounts =
        progress.mode === 'ordinary' ? [state.address, ...progress.accounts] : progress.accounts;
      const after =
        progress.mode === 'ordinary' ? (state.scannedBlock ?? -1) : (state.tokenBackfillAt ?? -1);
      if (progress.phase === 'stored') {
        if (Date.now() - started >= SYNC_TIME_BUDGET_MS) return partial();
        const rows: { signature: string; result: unknown }[] = await this.source.query(
          `SELECT DISTINCT ON (raw->>'signature') raw->>'signature' AS signature,
              raw->'transaction' AS result
            FROM wallet_address_transactions
            WHERE "addressId" = $1 AND raw->>'signature' > $2
            ORDER BY raw->>'signature' LIMIT $3`,
          [state.id, progress.storedAfter, STAKE_BACKFILL_PAGE],
        );
        const transactions = rows.flatMap((row) => {
          try {
            return [parseTransaction(row.result, row.signature)];
          } catch {
            return [];
          }
        });
        const tokenAccounts = new Set(progress.accounts);
        const legs = transactions.flatMap((tx) =>
          solanaLegs(state.address, tokenAccounts, tx).filter((leg) => leg.asset !== null),
        );
        const named = await this.named(solanaTokenFacts(transactions, legs));
        if (!named.ok) return failed(named.reason);
        const last = rows.length < STAKE_BACKFILL_PAGE;
        const next = {
          ...progress,
          phase: last ? ('discover' as const) : ('stored' as const),
          storedAfter: last ? '' : rows[rows.length - 1].signature,
        };
        const committed = await this.storeBackfill(
          state,
          legs,
          named.facts,
          last ? -1 : null,
          false,
          next,
        );
        imported += committed.inserted;
        state = committed.state;
        continue;
      }
      if (progress.phase === 'discover') {
        while (progress.accountIndex < accounts.length) {
          if (pages >= MAX_SIGNATURE_PAGES || Date.now() - started >= SYNC_TIME_BUDGET_MS)
            return partial();
          const found = await this.rpc.signatures(accounts[progress.accountIndex], progress.before);
          pages++;
          if (!found.ok) return failed(found.reason);
          const pending = new Map(progress.signatures.map((item) => [item.signature, item]));
          let done = found.items.length < SOLANA_SIGNATURE_PAGE_SIZE;
          for (const item of found.items) {
            if (item.slot <= after) {
              done = true;
              break;
            }
            if (item.slot <= progress.target) pending.set(item.signature, item);
          }
          const before = found.items.at(-1)?.signature ?? null;
          if (!done && before === progress.before) return failed('invalid_response');
          state = await this.checkpoint(state, {
            ...progress,
            accountIndex: progress.accountIndex + (done ? 1 : 0),
            before: done ? null : before,
            signatures: [...pending.values()],
          });
          progress = state.solanaSync as SyncProgress;
        }
        let signatures = progress.signatures;
        if (progress.mode === 'backfill' && signatures.length > 0) {
          const stored: { signature: string }[] = await this.source.query(
            `SELECT DISTINCT raw->>'signature' AS signature FROM wallet_address_transactions
              WHERE "addressId" = $1 AND raw->>'signature' = ANY($2::text[])`,
            [state.id, signatures.map((item) => item.signature)],
          );
          const seen = new Set(stored.map((row) => row.signature));
          signatures = signatures.filter((item) => !seen.has(item.signature));
        }
        state = await this.checkpoint(state, {
          ...progress,
          phase: 'ingest',
          signatures: signatures.sort(
            (left, right) =>
              left.slot - right.slot || left.signature.localeCompare(right.signature),
          ),
        });
        continue;
      }
      if (progress.position === progress.signatures.length) {
        if (progress.mode === 'backfill') {
          const committed = await this.storeBackfill(state, [], [], null, true, null);
          state = committed.state;
          continue;
        }
        const committed = await this.commit(state, [], [], [], progress.target, true, null);
        state = committed.state;
        const stake = await this.refreshStake(state, progress.target);
        return stake ? failed(stake) : { outcome: 'complete', reason: null, imported };
      }
      const slot = progress.signatures[progress.position].slot;
      let next = progress.position;
      while (next < progress.signatures.length && progress.signatures[next].slot === slot) next++;
      for (let index = progress.position + progress.staged.length; index < next; index++) {
        if (fetched >= MAX_TRANSACTIONS_PER_SYNC || Date.now() - started >= SYNC_TIME_BUDGET_MS)
          return partial();
        const signature = progress.signatures[index].signature;
        const found = await this.rpc.transaction(signature);
        fetched++;
        if (!found.ok) return failed(found.reason);
        if (found.transaction.slot !== slot) return failed('invalid_response');
        state = await this.checkpoint(state, {
          ...progress,
          staged: [...progress.staged, { signature, raw: found.transaction.raw }],
        });
        progress = state.solanaSync as SyncProgress;
      }
      if (Date.now() - started >= SYNC_TIME_BUDGET_MS) return partial();
      const read = progress.staged.map((item) => parseTransaction(item.raw, item.signature));
      const tokenAccounts = new Set(progress.accounts);
      const legs = read.flatMap((tx) => solanaLegs(state.address, tokenAccounts, tx));
      const named = await this.named(solanaTokenFacts(read, legs));
      if (!named.ok) return failed(named.reason);
      const done = next === progress.signatures.length;
      const nextProgress = done ? null : { ...progress, position: next, staged: [] };
      if (progress.mode === 'backfill') {
        const committed = await this.storeBackfill(
          state,
          legs,
          named.facts,
          done ? null : slot,
          done,
          nextProgress,
        );
        imported += committed.inserted;
        state = committed.state;
        continue;
      }
      const stake = read.flatMap((tx) => {
        const record = stakeRecord(state.address, tx);
        return record ? [record] : [];
      });
      const committed = await this.commit(
        state,
        legs,
        named.facts,
        stake,
        done ? progress.target : slot,
        done,
        nextProgress,
      );
      imported += committed.inserted;
      state = committed.state;
      if (done) {
        const refused = await this.refreshStake(state, progress.target);
        return refused ? failed(refused) : { outcome: 'complete', reason: null, imported };
      }
    }
  }

  /** TOKEN-ANY: the wallet's token accounts of every mint, of both token programs. */
  private async tokenAccounts(
    address: string,
  ): Promise<{ ok: true; accounts: Set<string> } | { ok: false; reason: StepFailure }> {
    const accounts = new Set<string>();
    for (const programId of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
      const found = await this.rpc.tokenAccounts(address, { programId });
      if (!found.ok) return found;
      for (const account of found.accounts) accounts.add(account);
    }
    // Read in one order whatever program holds each account.
    return { ok: true, accounts: new Set([...accounts].sort()) };
  }

  /**
   * TOKEN-ANY: the facts of the tokens not stored yet, with the name and symbol their mint
   * (Token-2022) or Metaplex metadata account gives and the mint's own decimals. Tokens already
   * stored keep what was stored.
   */
  private async named(facts: TokenFacts[]): Promise<Named> {
    if (facts.length === 0) return { ok: true, facts };
    const stored: { contract: string }[] = await this.source.query(
      `SELECT contract FROM chain_tokens WHERE network = 'solana' AND contract = ANY($1::text[])`,
      [facts.map((item) => item.contract)],
    );
    const known = new Set(stored.map((row) => row.contract));
    const fresh = facts.filter((item) => !known.has(item.contract));
    const named: TokenFacts[] = [];
    for (let start = 0; start < fresh.length; start += MINTS_PER_CALL) {
      const batch = fresh.slice(start, start + MINTS_PER_CALL);
      const read = await this.rpc.accounts(
        batch.flatMap((item) => [item.contract, metadataAddress(item.contract)]),
      );
      if (!read.ok) return read;
      batch.forEach((item, index) => {
        const mint = parseMint(read.values[index * 2]);
        const names =
          item.contract === WRAPPED_SOL
            ? { symbol: 'wSOL', name: 'Wrapped SOL' }
            : (mint.names ?? parseMetadata(read.values[index * 2 + 1], item.contract));
        named.push({
          ...item,
          symbol: names?.symbol ?? null,
          name: names?.name ?? null,
          decimals: mint.decimals ?? item.decimals,
        });
      });
    }
    return { ok: true, facts: [...facts.filter((item) => known.has(item.contract)), ...named] };
  }

  private assertCurrent(
    current: ScanRow | undefined,
    expected: ScanRow,
  ): asserts current is ScanRow {
    if (
      !current ||
      current.scannedBlock !== expected.scannedBlock ||
      current.tokenBackfillTo !== expected.tokenBackfillTo ||
      current.tokenBackfillAt !== expected.tokenBackfillAt ||
      (current.solanaSync?.revision ?? null) !== (expected.solanaSync?.revision ?? null)
    )
      throw new ConflictException('Another sync advanced this address');
  }

  private checkpoint(expected: ScanRow, next: SyncProgress): Promise<ScanRow> {
    return this.source.transaction('READ COMMITTED', async (manager) => {
      const [current]: ScanRow[] = await manager.query(
        `SELECT ${scanColumns} FROM wallet_addresses
          WHERE "ownerId" = $1 AND id = $2 AND "removedAt" IS NULL FOR UPDATE`,
        [expected.ownerId, expected.id],
      );
      this.assertCurrent(current, expected);
      const progress = { ...next, revision: randomUUID() };
      await manager.query(
        `UPDATE wallet_addresses SET "solanaSync" = $3::jsonb
          WHERE "ownerId" = $1 AND id = $2 AND "removedAt" IS NULL`,
        [current.ownerId, current.id, JSON.stringify(progress)],
      );
      return { ...current, solanaSync: progress };
    });
  }

  /** Stores backfilled legs and how far the backfill got in the same transaction. */
  private storeBackfill(
    expected: ScanRow,
    legs: SolanaLeg[],
    facts: TokenFacts[],
    at: number | null,
    done: boolean,
    next: SyncProgress | null,
  ) {
    return this.source.transaction('READ COMMITTED', async (manager) => {
      const [current]: ScanRow[] = await manager.query(
        `SELECT ${scanColumns} FROM wallet_addresses
          WHERE "ownerId" = $1 AND id = $2 AND "removedAt" IS NULL FOR UPDATE`,
        [expected.ownerId, expected.id],
      );
      this.assertCurrent(current, expected);
      const countable = await registerChainTokens(manager, 'solana', facts);
      const inserted = await this.insert(
        manager,
        current,
        countableLegs('solana', legs, countable),
      );
      const state = {
        ...current,
        tokenBackfillTo: done ? null : current.tokenBackfillTo,
        tokenBackfillAt: done ? null : (at ?? current.tokenBackfillAt),
        solanaSync: next ? { ...next, revision: randomUUID() } : null,
      };
      await manager.query(
        `UPDATE wallet_addresses SET "tokenBackfillTo" = $3, "tokenBackfillAt" = $4,
          "solanaSync" = $5::jsonb WHERE "ownerId" = $1 AND id = $2 AND "removedAt" IS NULL`,
        [
          current.ownerId,
          current.id,
          state.tokenBackfillTo,
          state.tokenBackfillAt,
          state.solanaSync ? JSON.stringify(state.solanaSync) : null,
        ],
      );
      return { inserted, state };
    });
  }

  private async scan(owner: string, id: string): Promise<ScanRow> {
    const [row]: ScanRow[] = await this.source.query(
      `SELECT ${scanColumns}
        FROM wallet_addresses WHERE "ownerId" = $1 AND id = $2
          AND network = 'solana' AND "removedAt" IS NULL`,
      [owner, id],
    );
    if (!row) throw new NotFoundException();
    return row;
  }

  /** Stores the legs of whole slots and moves the cursor past them in one transaction. */
  private commit(
    expected: ScanRow,
    legs: SolanaLeg[],
    facts: TokenFacts[],
    stake: StakeRecord[],
    end: number,
    caughtUp: boolean,
    next: SyncProgress | null,
  ) {
    return this.source.transaction('READ COMMITTED', async (manager) => {
      const [current]: ScanRow[] = await manager.query(
        `SELECT ${scanColumns} FROM wallet_addresses
          WHERE "ownerId" = $1 AND id = $2 AND "removedAt" IS NULL FOR UPDATE`,
        [expected.ownerId, expected.id],
      );
      this.assertCurrent(current, expected);
      const countable = await registerChainTokens(manager, 'solana', facts);
      const inserted = await this.insert(
        manager,
        current,
        countableLegs('solana', legs, countable),
      );
      await this.insertStake(manager, current, stake);
      const state = {
        ...current,
        scannedBlock: end,
        solanaSync: next ? { ...next, revision: randomUUID() } : null,
      };
      // "completedAt" marks a history read up to a finalized slot: the balance can be shown.
      await manager.query(
        `UPDATE wallet_addresses SET "scannedBlock" = $3,
          "completedAt" = CASE WHEN $4 THEN clock_timestamp() ELSE "completedAt" END,
          "solanaSync" = $5::jsonb
          WHERE "ownerId" = $1 AND id = $2 AND "removedAt" IS NULL`,
        [
          current.ownerId,
          current.id,
          end,
          caughtUp,
          state.solanaSync ? JSON.stringify(state.solanaSync) : null,
        ],
      );
      return { inserted, state };
    });
  }

  private async insert(manager: EntityManager, address: ScanRow, legs: SolanaLeg[]) {
    let count = 0;
    for (let start = 0; start < legs.length; start += 1_000) {
      const values: unknown[] = [];
      const rows = legs.slice(start, start + 1_000).map((leg) => {
        const base = values.length;
        values.push(
          address.ownerId,
          address.id,
          leg.txid,
          leg.blockHeight,
          leg.blockTime,
          leg.receivedUnits.toString(),
          leg.sentUnits.toString(),
          leg.feeUnits.toString(),
          leg.direction,
          JSON.stringify(leg.raw),
          leg.asset,
        );
        const slot = (offset: number) => `$${base + offset}`;
        return `(${slot(1)},${slot(2)},${slot(3)},${slot(4)},NULL,${slot(5)},${slot(6)}::numeric,${slot(7)}::numeric,${slot(8)}::numeric,${slot(9)},${slot(10)}::jsonb,${slot(11)})`;
      });
      const inserted: { txid: string }[] = await manager.query(
        `INSERT INTO wallet_address_transactions ("ownerId", "addressId", txid, "blockHeight", "blockHash",
          "blockTime", "receivedUnits", "sentUnits", "feeUnits", direction, raw, asset)
          VALUES ${rows.join(',')} ON CONFLICT ("addressId", txid) DO NOTHING RETURNING txid`,
        values,
      );
      count += inserted.length;
    }
    return count;
  }

  private async insertStake(manager: EntityManager, address: ScanRow, records: StakeRecord[]) {
    for (const record of records) {
      for (const account of record.activity.accounts) {
        await manager.query(
          `INSERT INTO wallet_stake_accounts ("ownerId", "addressId", account)
            VALUES ($1, $2, $3) ON CONFLICT ("addressId", account) DO NOTHING`,
          [address.ownerId, address.id, account],
        );
      }
      for (const move of record.activity.moves) {
        await manager.query(
          `INSERT INTO wallet_stake_moves ("ownerId", "addressId", signature, account, slot,
            "blockTime", units) VALUES ($1, $2, $3, $4, $5, $6, $7::numeric)
            ON CONFLICT ("addressId", signature, account) DO NOTHING`,
          [
            address.ownerId,
            address.id,
            record.signature,
            move.account,
            record.slot,
            record.blockTime,
            move.units.toString(),
          ],
        );
      }
    }
  }

  /**
   * SOL-STAKE-FIND: an address synced before stake accounts were followed has its stored
   * transactions read once for them; no request leaves the server. A new address is marked
   * read at once: every transaction it stores from then on is read as it arrives.
   */
  private async backfillStake(state: ScanRow): Promise<void> {
    const [done] = await this.source.query(
      'SELECT 1 FROM wallet_stake_scans WHERE "addressId" = $1',
      [state.id],
    );
    if (done) return;
    await this.source.transaction('READ COMMITTED', async (manager) => {
      const [current]: ScanRow[] = await manager.query(
        `SELECT ${scanColumns} FROM wallet_addresses
          WHERE "ownerId" = $1 AND id = $2 AND "removedAt" IS NULL FOR UPDATE`,
        [state.ownerId, state.id],
      );
      if (!current) throw new NotFoundException();
      const [again] = await manager.query(
        'SELECT 1 FROM wallet_stake_scans WHERE "addressId" = $1',
        [state.id],
      );
      if (again) return;
      // Only a transaction naming the stake program can act on a stake account.
      let after = '';
      for (;;) {
        const rows: { txid: string; result: unknown }[] = await manager.query(
          `SELECT txid, raw->'transaction' AS result FROM wallet_address_transactions
            WHERE "addressId" = $1 AND asset IS NULL AND txid > $2
              AND strpos(raw::text, $3) > 0
            ORDER BY txid LIMIT $4`,
          [state.id, after, STAKE_PROGRAM, STAKE_BACKFILL_PAGE],
        );
        const records = rows.flatMap((row) => {
          try {
            const record = stakeRecord(current.address, parseTransaction(row.result, row.txid));
            return record ? [record] : [];
          } catch {
            // A stored transaction is the provider's answer as checked when it arrived.
            return [];
          }
        });
        await this.insertStake(manager, current, records);
        if (rows.length < STAKE_BACKFILL_PAGE) break;
        after = rows[rows.length - 1].txid;
      }
      await manager.query(
        'INSERT INTO wallet_stake_scans ("ownerId", "addressId") VALUES ($1, $2)',
        [state.ownerId, state.id],
      );
    });
  }

  /**
   * SOL-STAKE-STATE, SOL-STAKE-REWARD: once the history is read up to `target`, each known stake
   * account's balance is read. Growth no stored transaction explains is a staking reward,
   * recorded once at `target` unless a transaction newer than `target` touched the account (its
   * history is not stored yet, so the next pass decides). A balance below what the history
   * explains waits for that history too. Returns the provider's refusal, if any.
   */
  private async refreshStake(state: ScanRow, target: number) {
    const known: { account: string }[] = await this.source.query(
      'SELECT account FROM wallet_stake_accounts WHERE "addressId" = $1 ORDER BY account',
      [state.id],
    );
    if (known.length === 0) return null;
    const epoch = await this.rpc.epoch();
    if (!epoch.ok) return epoch.reason;
    const states: StakeAccountState[] = [];
    for (let start = 0; start < known.length; start += SOLANA_ACCOUNTS_PER_CALL) {
      const keys = known.slice(start, start + SOLANA_ACCOUNTS_PER_CALL).map((row) => row.account);
      const read = await this.rpc.accounts(keys);
      if (!read.ok) return read.reason;
      for (const [index, value] of read.values.entries()) {
        const parsed = parseStakeAccount(keys[index], value, epoch.epoch);
        if (!parsed) return 'invalid_response' as const;
        states.push(parsed);
      }
    }
    const grown = new Set<string>();
    const explained = await this.explained(this.source.manager, state.id);
    for (const item of states) {
      if (item.lamports <= (explained.get(item.account) ?? 0n)) continue;
      const newest = await this.rpc.newestSlot(item.account);
      if (!newest.ok) return newest.reason;
      if (newest.slot === null || newest.slot <= target) grown.add(item.account);
    }
    await this.source.transaction('READ COMMITTED', async (manager) => {
      const [current]: ScanRow[] = await manager.query(
        `SELECT ${scanColumns} FROM wallet_addresses
          WHERE "ownerId" = $1 AND id = $2 AND "removedAt" IS NULL FOR UPDATE`,
        [state.ownerId, state.id],
      );
      if (!current) throw new NotFoundException();
      // Another pass may have stored more since; only growth still unexplained counts.
      const now = await this.explained(manager, state.id);
      for (const item of states) {
        await manager.query(
          `UPDATE wallet_stake_accounts SET lamports = $3::numeric, validator = $4, state = $5,
            "observedAt" = clock_timestamp() WHERE "addressId" = $1 AND account = $2`,
          [state.id, item.account, item.lamports.toString(), item.validator, item.state],
        );
        const reward = item.lamports - (now.get(item.account) ?? 0n);
        if (!grown.has(item.account) || reward <= 0n || (current.scannedBlock ?? -1) < target)
          continue;
        await manager.query(
          `INSERT INTO wallet_stake_rewards ("ownerId", "addressId", account, slot, "observedAt",
            units) VALUES ($1, $2, $3, $4, clock_timestamp(), $5::numeric)
            ON CONFLICT ("addressId", account, slot)
            DO UPDATE SET units = wallet_stake_rewards.units + EXCLUDED.units`,
          [state.ownerId, state.id, item.account, target, reward.toString()],
        );
      }
    });
    return null;
  }

  /** Per stake account: what the stored moves and rewards say it holds. */
  private async explained(manager: EntityManager, addressId: string) {
    const rows: { account: string; units: string }[] = await manager.query(
      `SELECT account, sum(units)::text AS units FROM (
          SELECT account, units FROM wallet_stake_moves WHERE "addressId" = $1
          UNION ALL
          SELECT account, units FROM wallet_stake_rewards WHERE "addressId" = $1
        ) stake GROUP BY account`,
      [addressId],
    );
    return new Map(rows.map((row) => [row.account, BigInt(row.units)]));
  }
}
