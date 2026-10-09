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
// Signature pages of one address in one pass: 50 000 signatures.
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
}

const scanColumns = `id, "ownerId", address, "scannedBlock", "tokenBackfillTo", "tokenBackfillAt"`;
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
    const target = tip.slot;
    const started = Date.now();
    // TOKEN-BACKFILL: the stored history is read again for other tokens before anything new.
    if (state.tokenBackfillTo !== null) {
      const accounts = await this.tokenAccounts(state.address);
      if (!accounts.ok) return failed(accounts.reason);
      const filled = await this.backfillTokens(state, accounts.accounts, started);
      imported += filled.imported;
      if (filled.reason) return failed(filled.reason);
      if (filled.state.tokenBackfillTo !== null)
        return { outcome: 'partial', reason: null, imported };
      state = filled.state;
    }
    const after = state.scannedBlock ?? -1;
    if (after >= target) {
      await this.commit(state, [], [], [], after, true);
      const stake = await this.refreshStake(state, target);
      if (stake) return failed(stake);
      return { outcome: 'complete', reason: null, imported };
    }
    const listed = await this.tokenAccounts(state.address);
    if (!listed.ok) return failed(listed.reason);
    const tokenAccounts = listed.accounts;
    const pending = new Map<string, SignatureInfo>();
    for (const address of [state.address, ...tokenAccounts]) {
      const listed = await this.newSignatures(address, after, target);
      if (!listed.ok) return failed(listed.reason);
      for (const item of listed.items) pending.set(item.signature, item);
    }
    const ordered = [...pending.values()].sort(
      (left, right) => left.slot - right.slot || left.signature.localeCompare(right.signature),
    );

    // Whole slots, oldest first, until the pass budget is spent or the provider fails.
    const legs: SolanaLeg[] = [];
    const read: SolanaTransaction[] = [];
    const stake: StakeRecord[] = [];
    let end = after;
    let fetched = 0;
    let failure: StepFailure | null = null;
    let position = 0;
    while (position < ordered.length) {
      if (fetched >= MAX_TRANSACTIONS_PER_SYNC || Date.now() - started > SYNC_TIME_BUDGET_MS) break;
      const slot = ordered[position].slot;
      const slotLegs: SolanaLeg[] = [];
      const slotRead: SolanaTransaction[] = [];
      const slotStake: StakeRecord[] = [];
      let next = position;
      for (; next < ordered.length && ordered[next].slot === slot; next++) {
        const found = await this.rpc.transaction(ordered[next].signature);
        fetched++;
        if (found.ok && found.transaction.slot !== slot) failure = 'invalid_response';
        else if (!found.ok) failure = found.reason;
        if (failure) break;
        if (found.ok) {
          slotRead.push(found.transaction);
          slotLegs.push(...solanaLegs(state.address, tokenAccounts, found.transaction));
          const record = stakeRecord(state.address, found.transaction);
          if (record) slotStake.push(record);
        }
      }
      if (failure) break;
      legs.push(...slotLegs);
      read.push(...slotRead);
      stake.push(...slotStake);
      end = slot;
      position = next;
    }
    const caughtUp = failure === null && position === ordered.length;
    if (caughtUp) end = target;
    // TOKEN-ANY: a token met for the first time is named from its mint before it is stored.
    const named = await this.named(solanaTokenFacts(read, legs));
    if (!named.ok) return failed(named.reason);
    if (end !== after || caughtUp)
      imported += await this.commit(state, legs, named.facts, stake, end, caughtUp);
    if (failure) return { outcome: 'provider_error', reason: failure, imported };
    if (caughtUp) {
      const refused = await this.refreshStake({ ...state, scannedBlock: end }, target);
      if (refused) return { outcome: 'provider_error', reason: refused, imported };
    }
    return { outcome: caughtUp ? 'complete' : 'partial', reason: null, imported };
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

  /**
   * TOKEN-BACKFILL: an address read before every token was followed has its history up to
   * "tokenBackfillTo" read again for other tokens. First its stored transactions, with no
   * request; then the transactions of its token accounts it does not store yet, whole slots
   * oldest first within the pass's budget. A token account closed since keeps its history
   * unread, as in the sync itself.
   */
  private async backfillTokens(
    initial: ScanRow,
    tokenAccounts: ReadonlySet<string>,
    started: number,
  ): Promise<{ state: ScanRow; imported: number; reason: StepFailure | null }> {
    let state = initial;
    let imported = 0;
    const result = (reason: StepFailure | null = null) => ({ state, imported, reason });
    const to = state.tokenBackfillTo;
    if (to === null) return result();
    if (state.tokenBackfillAt === null) {
      let after = '';
      for (;;) {
        const rows: { signature: string; result: unknown }[] = await this.source.query(
          `SELECT DISTINCT ON (raw->>'signature') raw->>'signature' AS signature,
              raw->'transaction' AS result
            FROM wallet_address_transactions
            WHERE "addressId" = $1 AND raw->>'signature' > $2
            ORDER BY raw->>'signature' LIMIT $3`,
          [state.id, after, STAKE_BACKFILL_PAGE],
        );
        const transactions = rows.flatMap((row) => {
          try {
            return [parseTransaction(row.result, row.signature)];
          } catch {
            // A stored transaction is the provider's answer as checked when it arrived.
            return [];
          }
        });
        const legs = transactions.flatMap((tx) =>
          solanaLegs(state.address, tokenAccounts, tx).filter((leg) => leg.asset !== null),
        );
        const named = await this.named(solanaTokenFacts(transactions, legs));
        if (!named.ok) return result(named.reason);
        const last = rows.length < STAKE_BACKFILL_PAGE;
        const committed = await this.storeBackfill(state, legs, named.facts, last ? -1 : null);
        imported += committed.inserted;
        state = committed.state;
        if (last) break;
        after = rows[rows.length - 1].signature;
      }
    }
    const from = state.tokenBackfillAt ?? -1;
    const pending = new Map<string, SignatureInfo>();
    for (const account of [...tokenAccounts].sort()) {
      const listed = await this.newSignatures(account, from, to);
      if (!listed.ok) return result(listed.reason);
      for (const item of listed.items) pending.set(item.signature, item);
    }
    // What the wallet stores already was read again above.
    const stored: { signature: string }[] = await this.source.query(
      `SELECT DISTINCT raw->>'signature' AS signature FROM wallet_address_transactions
        WHERE "addressId" = $1 AND raw->>'signature' = ANY($2::text[])`,
      [state.id, [...pending.keys()]],
    );
    for (const row of stored) pending.delete(row.signature);
    const ordered = [...pending.values()].sort(
      (left, right) => left.slot - right.slot || left.signature.localeCompare(right.signature),
    );
    const read: SolanaTransaction[] = [];
    let end = from;
    let position = 0;
    let failure: StepFailure | null = null;
    while (position < ordered.length) {
      if (read.length >= MAX_TRANSACTIONS_PER_SYNC || Date.now() - started > SYNC_TIME_BUDGET_MS)
        break;
      const slot = ordered[position].slot;
      const slotRead: SolanaTransaction[] = [];
      let next = position;
      for (; next < ordered.length && ordered[next].slot === slot; next++) {
        const found = await this.rpc.transaction(ordered[next].signature);
        if (found.ok && found.transaction.slot !== slot) failure = 'invalid_response';
        else if (!found.ok) failure = found.reason;
        if (failure) break;
        if (found.ok) slotRead.push(found.transaction);
      }
      if (failure) break;
      read.push(...slotRead);
      end = slot;
      position = next;
    }
    const done = failure === null && position === ordered.length;
    const legs = read.flatMap((tx) => solanaLegs(state.address, tokenAccounts, tx));
    const named = await this.named(solanaTokenFacts(read, legs));
    if (!named.ok) return result(named.reason);
    if (done || end !== from) {
      const committed = await this.storeBackfill(state, legs, named.facts, done ? null : end, done);
      imported += committed.inserted;
      state = committed.state;
    }
    return result(failure);
  }

  /** Stores backfilled legs and how far the backfill got, or that it is done. */
  private storeBackfill(
    expected: ScanRow,
    legs: SolanaLeg[],
    facts: TokenFacts[],
    at: number | null,
    done = false,
  ) {
    return this.source.transaction('READ COMMITTED', async (manager) => {
      const [current]: ScanRow[] = await manager.query(
        `SELECT ${scanColumns} FROM wallet_addresses WHERE "ownerId" = $1 AND id = $2 FOR UPDATE`,
        [expected.ownerId, expected.id],
      );
      if (
        !current ||
        current.tokenBackfillTo !== expected.tokenBackfillTo ||
        current.tokenBackfillAt !== expected.tokenBackfillAt
      )
        throw new ConflictException('Another sync advanced this address');
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
      };
      await manager.query(
        `UPDATE wallet_addresses SET "tokenBackfillTo" = $3, "tokenBackfillAt" = $4
          WHERE "ownerId" = $1 AND id = $2`,
        [current.ownerId, current.id, state.tokenBackfillTo, state.tokenBackfillAt],
      );
      return { inserted, state };
    });
  }

  /** Signatures of one address in (after, target], newest first, every page of them. */
  private async newSignatures(address: string, after: number, target: number) {
    const items: SignatureInfo[] = [];
    let before: string | null = null;
    for (let page = 0; page < MAX_SIGNATURE_PAGES; page++) {
      const listed = await this.rpc.signatures(address, before);
      if (!listed.ok) return listed;
      for (const item of listed.items) {
        // Newest first: the first one at or below the stored slot ends the new history.
        if (item.slot <= after) return { ok: true as const, items };
        if (item.slot <= target) items.push(item);
      }
      if (listed.items.length < SOLANA_SIGNATURE_PAGE_SIZE) return { ok: true as const, items };
      before = listed.items[listed.items.length - 1].signature;
    }
    // More history than one pass may list: never store a part that would leave a gap.
    return { ok: false as const, reason: 'invalid_response' as const };
  }

  private async scan(owner: string, id: string): Promise<ScanRow> {
    const [row]: ScanRow[] = await this.source.query(
      `SELECT ${scanColumns}
        FROM wallet_addresses WHERE "ownerId" = $1 AND id = $2 AND network = 'solana'`,
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
  ) {
    return this.source.transaction('READ COMMITTED', async (manager) => {
      const [current]: ScanRow[] = await manager.query(
        `SELECT ${scanColumns} FROM wallet_addresses
          WHERE "ownerId" = $1 AND id = $2 FOR UPDATE`,
        [expected.ownerId, expected.id],
      );
      if (!current || current.scannedBlock !== expected.scannedBlock) {
        throw new ConflictException('Another sync advanced this address');
      }
      const countable = await registerChainTokens(manager, 'solana', facts);
      const inserted = await this.insert(
        manager,
        current,
        countableLegs('solana', legs, countable),
      );
      await this.insertStake(manager, current, stake);
      // "completedAt" marks a history read up to a finalized slot: the balance can be shown.
      await manager.query(
        `UPDATE wallet_addresses SET "scannedBlock" = $3,
          "completedAt" = CASE WHEN $4 THEN clock_timestamp() ELSE "completedAt" END
          WHERE "ownerId" = $1 AND id = $2`,
        [current.ownerId, current.id, end, caughtUp],
      );
      return inserted;
    });
  }

  private async insert(manager: EntityManager, address: ScanRow, legs: SolanaLeg[]) {
    if (legs.length === 0) return 0;
    const values: unknown[] = [];
    const rows = legs.map((leg) => {
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
    return inserted.length;
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
          WHERE "ownerId" = $1 AND id = $2 FOR UPDATE`,
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
          WHERE "ownerId" = $1 AND id = $2 FOR UPDATE`,
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
