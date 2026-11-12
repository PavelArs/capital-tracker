import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { ChainSyncAdapter, StepFailure, StepResult } from './chain-sync';
import { countableLegs, registerChainTokens, type TokenFacts } from './chain-tokens';
import { type EthereumLeg, ethereumLegs, ethereumTokenFacts, rangeEnd } from './ethereum-legs';
import {
  balanceOfUnderlyingCall,
  type EtherStakeMove,
  type EtherTransaction,
  etherStakeMoves,
  etherTransactions,
  readSymbol,
  readUint,
  STAKE_SELECTOR,
  stakeTarget,
  symbolCall,
} from './ethereum-stake';
import {
  EtherscanClient,
  type Failed,
  type InternalTransfer,
  type NormalTransaction,
  parseInternal,
  parseNormal,
  type TokenTransfer,
} from './etherscan-client';
import { readEvmBlock, type EvmScan as ScanRow, sameEvmScan } from './evm-block-progress';
import { type EvmChain, type EvmNetwork } from './evm-chains';
import { EvmReader } from './evm-reader';
import { jsonbText } from './jsonb-text';

// Blocks this deep are final; a shallower one could still be replaced and its rows are
// never rewritten, so they wait for the next pass.
export const CONFIRMATIONS = 64;
// Bounds for one pass; the next pass continues from the committed block.
export const MAX_RANGES_PER_SYNC = 10;
const SYNC_TIME_BUDGET_MS = 25_000;

const scanColumns = `id, "ownerId", address, "scannedBlock", "tokenBackfillTo", "tokenBackfillAt", "evmSync"`;

type Pools = { ok: true; pools: Set<string> } | { ok: false; reason: StepFailure };

/** A range's lists up to `end`, where every list is whole; `state` after any staged block. */
interface RangeLists {
  ok: true;
  state: ScanRow;
  end: number;
  normal: NormalTransaction[];
  internal: InternalTransfer[];
  tokens: TokenTransfer[];
}

/** A token range up to `end` and its transfers, or why it stopped; `state` after any staging. */
type TokenRange =
  | { ok: true; state: ScanRow; end: number; transfers: readonly TokenTransfer[] }
  | { ok: false; state: ScanRow; reason: StepFailure | null };

/** Whether a pass has read its share of ranges or used up its time. */
function budgetSpent(ranges: number, started: number): boolean {
  return ranges >= MAX_RANGES_PER_SYNC || Date.now() - started > SYNC_TIME_BUDGET_MS;
}

/** A stored ether leg's transaction as it arrived; null when it holds none the wallet sent. */
function storedTransaction(raw: {
  transaction: unknown;
  internal: unknown;
}): EtherTransaction | null {
  try {
    if (raw.transaction === null) return null;
    const tx = parseNormal(raw.transaction);
    const inner = Array.isArray(raw.internal) ? raw.internal.map(parseInternal) : [];
    return { tx, inner };
  } catch {
    // A stored transaction is the provider's answer as checked when it arrived.
    return null;
  }
}

// Ethereum-like history from Etherscan: block ranges from the last stored block up to a final
// one, each committed with its rows, so an interrupted pass resumes without gaps or
// duplicates. One adapter per chain (EVM-MULTICHAIN); staking pools exist on Ethereum only.
export class EvmSyncAdapter implements ChainSyncAdapter {
  readonly network: EvmNetwork;
  readonly name: string;
  private readonly etherscan: EvmReader;
  private readonly stake: boolean;

  constructor(
    private readonly source: DataSource,
    etherscan: EtherscanClient,
    chain: EvmChain,
  ) {
    this.network = chain.network;
    this.name = chain.name;
    this.etherscan = new EvmReader(
      etherscan.forChain(chain.chainId),
      chain.blockscout ? etherscan.blockscout(chain.blockscout, chain.chainId) : null,
    );
    this.stake = chain.network === 'ethereum';
  }

  async step(ownerId: string, addressId: string): Promise<StepResult> {
    const state = await this.scan(ownerId, addressId);
    if (!this.etherscan.configured) return this.finish('provider_error', 'not_configured', 0);
    const tip = await this.etherscan.blockNumber();
    if (!tip.ok) return this.finish('provider_error', tip.reason, 0);
    const target = tip.block - CONFIRMATIONS;
    if (state.evmSync && state.evmSync.block > target)
      return this.finish('provider_error', 'invalid_response', 0);
    const backfill = this.stake ? await this.backfillStake(state, target) : null;
    if (backfill) return this.finish('provider_error', backfill, 0);
    const started = Date.now();
    // TOKEN-BACKFILL: the stored history is read again for other tokens before anything new.
    const tokens = await this.backfillTokens(state, started);
    if (tokens.reason) return this.finish('provider_error', tokens.reason, tokens.imported);
    if (tokens.state.tokenBackfillTo !== null) return this.finish('partial', null, tokens.imported);
    return this.scanRanges(tokens.state, target, started, tokens.ranges, tokens.imported);
  }

  private finish(outcome: StepResult['outcome'], reason: StepFailure | null, imported: number) {
    return {
      outcome,
      reason,
      imported,
      // SYNC-DETAIL: what the source said, so "temporarily unavailable" can be told apart.
      detail: reason === null ? null : this.etherscan.detail,
    };
  }

  /** The history from the stored block on, range by range, each committed with its rows. */
  private async scanRanges(
    initial: ScanRow,
    target: number,
    started: number,
    ranges: number,
    imported: number,
  ): Promise<StepResult> {
    let state = initial;
    let count = imported;
    for (let range = ranges; ; range++) {
      const from = (state.scannedBlock ?? -1) + 1;
      if (from > target) return this.caughtUp(state, target, count);
      if (budgetSpent(range, started)) return this.finish('partial', null, count);
      const read = await this.readRange(state, from, target, started);
      if (!read.ok)
        return this.finish(read.reason ? 'provider_error' : 'partial', read.reason, count);
      const rows = await this.rangeRows(read, from, target);
      if (!rows.ok) return this.finish('provider_error', rows.reason, count);
      const done = read.end === target;
      const committed = await this.commit(
        read.state,
        rows.legs,
        rows.facts,
        rows.moves,
        read.end,
        done,
      );
      count += committed.inserted;
      if (done) return this.complete(committed.state, target, count);
      state = committed.state;
    }
  }

  /** Nothing final since the last pass: the stored history is complete as it is. */
  private async caughtUp(state: ScanRow, target: number, imported: number): Promise<StepResult> {
    const committed = await this.commit(state, [], [], [], state.scannedBlock ?? target, true);
    return this.complete(committed.state, target, imported);
  }

  /** The pools are read as of the block the stored history ends at. */
  private async complete(at: ScanRow, target: number, imported: number): Promise<StepResult> {
    const refused = this.stake ? await this.refreshStake(at, at.scannedBlock ?? target) : null;
    return refused
      ? this.finish('provider_error', refused, imported)
      : this.finish('complete', null, imported);
  }

  /**
   * One range's lists from `from`, up to the last block every list returned whole. A block that
   * alone fills a page, or one already staged, is read page by page; a null reason means it is
   * staged only in part.
   */
  private async readRange(
    state: ScanRow,
    from: number,
    target: number,
    started: number,
  ): Promise<RangeLists | { ok: false; reason: StepFailure | null }> {
    if (!state.evmSync) {
      const normal = await this.etherscan.normal(state.address, from, target);
      if (!normal.ok) return normal;
      const internal = await this.internalUpTo(state.address, from, target, started);
      if (!internal.ok) return internal;
      const tokens = await this.etherscan.tokens(state.address, from, target);
      if (!tokens.ok) return tokens;
      const end = rangeEnd(from, internal.end, [normal.items, internal.items, tokens.items]);
      if (end !== null) {
        const lists = { normal: normal.items, internal: internal.items, tokens: tokens.items };
        return { ok: true, state, end, ...lists };
      }
    }
    const staged = await readEvmBlock(this.source, this.etherscan, state, 'history', started);
    if (!staged.ok) return staged;
    if (!staged.complete) return { ok: false, reason: null };
    const { normal, internal, tokens } = staged;
    return { ok: true, state: staged.state, end: staged.end, normal, internal, tokens };
  }

  /** The legs, token facts and staking moves of a range's items from `from` to its end. */
  private async rangeRows(range: RangeLists, from: number, target: number) {
    const { state, end } = range;
    const within = <T extends { blockNumber: number }>(items: readonly T[]) =>
      items.filter((item) => item.blockNumber >= from && item.blockNumber <= end);
    const transfers = within(range.tokens);
    const legs = ethereumLegs(
      state.address,
      within(range.normal),
      within(range.internal),
      transfers,
      this.network,
    );
    const sent = etherTransactions(state.address, within(range.normal), within(range.internal));
    const pools = this.stake
      ? await this.pools(state, sent, target)
      : { ok: true as const, pools: new Set<string>() };
    if (!pools.ok) return pools;
    const moves = etherStakeMoves(state.address, sent, pools.pools);
    return { ok: true as const, legs, facts: ethereumTokenFacts(transfers, this.network), moves };
  }

  /**
   * UNPROCESSED: Blockscout refuses a range of internal transfers that holds blocks it has not
   * indexed yet, and an empty list would lose them once the scan moves on. The range is then cut
   * to the largest end it answers for, so the history up to the first unindexed block is stored
   * now; when even the first block is refused, the refusal is returned and the pass asks again
   * later.
   */
  private async internalUpTo(
    address: string,
    from: number,
    to: number,
    started: number,
  ): Promise<{ ok: true; items: InternalTransfer[]; end: number } | Failed> {
    const whole = await this.etherscan.internal(address, from, to);
    if (whole.ok) return { ok: true, items: whole.items, end: to };
    if (!whole.unprocessed) return whole;
    const first = await this.etherscan.internal(address, from, from);
    if (!first.ok) return first;
    let items = first.items;
    let known = from;
    let refused = to;
    while (refused - known > 1 && Date.now() - started <= SYNC_TIME_BUDGET_MS) {
      const middle = known + Math.floor((refused - known) / 2);
      const read = await this.etherscan.internal(address, from, middle);
      if (read.ok) {
        known = middle;
        items = read.items;
      } else if (read.unprocessed) {
        refused = middle;
      } else {
        return read;
      }
    }
    return { ok: true, items, end: known };
  }

  private async scan(owner: string, id: string): Promise<ScanRow> {
    const [row]: ScanRow[] = await this.source.query(
      `SELECT ${scanColumns}
        FROM wallet_addresses WHERE "ownerId" = $1 AND id = $2 AND network = $3 AND "removedAt" IS NULL`,
      [owner, id, this.network],
    );
    if (!row) throw new NotFoundException();
    return row;
  }

  /** Stores one range's legs and moves the cursor past it in one transaction. */
  private commit(
    expected: ScanRow,
    legs: EthereumLeg[],
    facts: TokenFacts[],
    moves: EtherStakeMove[],
    end: number,
    caughtUp: boolean,
  ) {
    return this.source.transaction('READ COMMITTED', async (manager) => {
      const [current]: ScanRow[] = await manager.query(
        `SELECT ${scanColumns} FROM wallet_addresses
          WHERE "ownerId" = $1 AND id = $2 AND "removedAt" IS NULL FOR UPDATE`,
        [expected.ownerId, expected.id],
      );
      if (!sameEvmScan(current, expected)) {
        throw new ConflictException('Another sync advanced this address');
      }
      await this.insertStake(manager, current, moves);
      const inserted = await this.insertLegs(manager, current, legs, facts);
      // "completedAt" marks a history read up to a final block: the balance can be shown.
      await manager.query(
        `UPDATE wallet_addresses SET "scannedBlock" = $3, "evmSync" = NULL,
          "completedAt" = CASE WHEN $4 THEN clock_timestamp() ELSE "completedAt" END
          WHERE "ownerId" = $1 AND id = $2`,
        [current.ownerId, current.id, end, caughtUp],
      );
      return { inserted, state: { ...current, scannedBlock: end, evmSync: null } };
    });
  }

  /**
   * TOKEN-BACKFILL: an address read before every token was followed has the token transfers of
   * its stored history read again, range by range, oldest first; ether and the legs already
   * stored stay as they are. Shares the pass's budget; returns how far it got.
   */
  private async backfillTokens(
    initial: ScanRow,
    started: number,
  ): Promise<{ state: ScanRow; ranges: number; imported: number; reason: StepFailure | null }> {
    let state = initial;
    let imported = 0;
    let ranges = 0;
    const result = (reason: StepFailure | null = null) => ({ state, ranges, imported, reason });
    while (state.tokenBackfillTo !== null) {
      const to = state.tokenBackfillTo;
      const from = (state.tokenBackfillAt ?? -1) + 1;
      let range: TokenRange = { ok: true, state, end: to, transfers: [] };
      if (from <= to) {
        if (budgetSpent(ranges, started)) return result();
        ranges++;
        range = await this.readTokenRange(state, from, to, started);
        if (!range.ok) {
          state = range.state;
          return result(range.reason);
        }
      }
      const committed = await this.commitTokenRange(range.state, range.transfers, range.end, to);
      imported += committed.inserted;
      state = committed.state;
    }
    return result();
  }

  /**
   * One token range from `from` up to the last block the list returned whole. A block that alone
   * fills a page, or one already staged, is read page by page; a null reason means it is staged
   * only in part.
   */
  private async readTokenRange(
    state: ScanRow,
    from: number,
    to: number,
    started: number,
  ): Promise<TokenRange> {
    if (!state.evmSync) {
      const read = await this.etherscan.tokens(state.address, from, to);
      if (!read.ok) return { ok: false, state, reason: read.reason };
      const last = rangeEnd(from, to, [read.items]);
      if (last !== null) {
        const transfers = read.items.filter(
          (item) => item.blockNumber >= from && item.blockNumber <= last,
        );
        return { ok: true, state, end: last, transfers };
      }
    }
    const staged = await readEvmBlock(this.source, this.etherscan, state, 'tokens', started);
    if (!staged.ok) return { ok: false, state, reason: staged.reason };
    if (!staged.complete) return { ok: false, state: staged.state, reason: null };
    return { ok: true, state: staged.state, end: staged.end, transfers: staged.tokens };
  }

  /** Stores a token range's legs and moves the backfill past it; done once it reaches `to`. */
  private commitTokenRange(
    expected: ScanRow,
    transfers: readonly TokenTransfer[],
    end: number,
    to: number,
  ) {
    return this.source.transaction('READ COMMITTED', async (manager) => {
      const [current]: ScanRow[] = await manager.query(
        `SELECT ${scanColumns} FROM wallet_addresses
            WHERE "ownerId" = $1 AND id = $2 AND "removedAt" IS NULL FOR UPDATE`,
        [expected.ownerId, expected.id],
      );
      if (!sameEvmScan(current, expected))
        throw new ConflictException('Another sync advanced this address');
      const legs = ethereumLegs(current.address, [], [], transfers, this.network);
      const inserted = await this.insertLegs(
        manager,
        current,
        legs,
        ethereumTokenFacts(transfers, this.network),
      );
      const done = end === to;
      await manager.query(
        `UPDATE wallet_addresses SET "tokenBackfillTo" = $3, "tokenBackfillAt" = $4, "evmSync" = NULL
            WHERE "ownerId" = $1 AND id = $2`,
        [current.ownerId, current.id, done ? null : to, done ? null : end],
      );
      return {
        inserted,
        state: {
          ...current,
          tokenBackfillTo: done ? null : to,
          tokenBackfillAt: done ? null : end,
          evmSync: null,
        },
      };
    });
  }

  /**
   * TOKEN-ANY: stores the legs with the tokens they name. A token a staking pool of the address
   * issues for its deposit is that pool's share, already the wallet's staked ether
   * (ETH-STAKE-BALANCE): it is left out, so the stake never counts twice.
   */
  private async insertLegs(
    manager: EntityManager,
    address: ScanRow,
    legs: EthereumLeg[],
    facts: TokenFacts[],
  ) {
    const pools: { contract: string }[] = await manager.query(
      'SELECT contract FROM wallet_ether_stake_positions WHERE "addressId" = $1',
      [address.id],
    );
    const shares = new Set(pools.map((row) => row.contract));
    const countable = await registerChainTokens(
      manager,
      this.network,
      facts.filter((item) => !shares.has(item.contract)),
    );
    return this.insert(manager, address, countableLegs(this.network, legs, countable));
  }

  private async insert(manager: EntityManager, address: ScanRow, legs: EthereumLeg[]) {
    if (legs.length === 0) return 0;
    let count = 0;
    for (let start = 0; start < legs.length; start += 1000) {
      const values: unknown[] = [];
      const rows = legs.slice(start, start + 1000).map((leg) => {
        const base = values.length;
        values.push(
          address.ownerId,
          address.id,
          leg.txid,
          leg.blockHeight,
          leg.blockHash,
          leg.blockTime,
          leg.receivedUnits.toString(),
          leg.sentUnits.toString(),
          leg.feeUnits.toString(),
          leg.direction,
          jsonbText(leg.raw),
          leg.asset,
        );
        const slot = (offset: number) => `$${base + offset}`;
        return `(${slot(1)},${slot(2)},${slot(3)},${slot(4)},${slot(5)},${slot(6)},${slot(7)}::numeric,${slot(8)}::numeric,${slot(9)}::numeric,${slot(10)},${slot(11)}::jsonb,${slot(12)})`;
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

  /**
   * ETH-STAKE-FIND: the pools the address is known to have deposited into, and any new contract
   * one of `sent` called stake() on with ether once it answers balanceOfUnderlying as of
   * `block`. A contract that does not is no pool here: its deposit stays an ordinary payment.
   */
  private async pools(state: ScanRow, sent: readonly EtherTransaction[], block: number) {
    const known: { contract: string }[] = await this.source.query(
      'SELECT contract FROM wallet_ether_stake_positions WHERE "addressId" = $1',
      [state.id],
    );
    const pools = new Set(known.map((row) => row.contract));
    const candidates = new Set(
      sent.flatMap(({ tx }) => {
        const target = stakeTarget(state.address, tx);
        return target && !pools.has(target) ? [target] : [];
      }),
    );
    return this.verify(state, pools, candidates, block);
  }

  private async verify(
    state: ScanRow,
    pools: Set<string>,
    candidates: Iterable<string>,
    block: number,
  ): Promise<Pools> {
    for (const contract of [...candidates].sort()) {
      const read = await this.etherscan.call(
        contract,
        balanceOfUnderlyingCall(state.address),
        block,
      );
      if (!read.ok) return read;
      if (readUint(read.data) !== null) pools.add(contract);
    }
    return { ok: true, pools };
  }

  private async insertStake(manager: EntityManager, address: ScanRow, moves: EtherStakeMove[]) {
    for (const contract of new Set(moves.map((move) => move.contract))) {
      await manager.query(
        `INSERT INTO wallet_ether_stake_positions ("ownerId", "addressId", contract)
          VALUES ($1, $2, $3) ON CONFLICT ("addressId", contract) DO NOTHING`,
        [address.ownerId, address.id, contract],
      );
    }
    for (const move of moves) {
      await manager.query(
        `INSERT INTO wallet_ether_stake_moves ("ownerId", "addressId", txid, contract,
          "blockHeight", "blockTime", units) VALUES ($1, $2, $3, $4, $5, $6, $7::numeric)
          ON CONFLICT ("addressId", txid, contract) DO NOTHING`,
        [
          address.ownerId,
          address.id,
          move.txid,
          move.contract,
          move.blockHeight,
          move.blockTime,
          move.units.toString(),
        ],
      );
    }
  }

  /**
   * ETH-STAKE-FIND: an address synced before pools were followed has its stored transactions
   * read once for them. Only the contracts its stake() calls went to are asked whether they are
   * pools; a new address is marked read at once. Returns the provider's refusal, if any.
   */
  private async backfillStake(state: ScanRow, block: number): Promise<StepFailure | null> {
    const done = async (manager: EntityManager = this.source.manager) =>
      (await manager.query('SELECT 1 FROM wallet_stake_scans WHERE "addressId" = $1', [state.id]))
        .length > 0;
    if (await done()) return null;
    const called: { contract: string }[] = await this.source.query(
      `SELECT DISTINCT lower(raw->'transaction'->>'to') AS contract
        FROM wallet_address_transactions
        WHERE "addressId" = $1 AND asset IS NULL
          AND lower(raw->'transaction'->>'from') = $2
          AND starts_with(lower(raw->'transaction'->>'input'), $3)
        ORDER BY 1`,
      [state.id, state.address, STAKE_SELECTOR],
    );
    const verified = await this.verify(
      state,
      new Set(),
      called.flatMap((row) => (/^0x[0-9a-f]{40}$/.test(row.contract) ? [row.contract] : [])),
      block,
    );
    if (!verified.ok) return verified.reason;
    await this.source.transaction('READ COMMITTED', async (manager) => {
      const [current]: ScanRow[] = await manager.query(
        `SELECT ${scanColumns} FROM wallet_addresses
          WHERE "ownerId" = $1 AND id = $2 AND "removedAt" IS NULL FOR UPDATE`,
        [state.ownerId, state.id],
      );
      if (!current) throw new NotFoundException();
      if (await done(manager)) return;
      const pools = [...verified.pools];
      const rows: { raw: { transaction: unknown; internal: unknown } }[] =
        pools.length === 0
          ? []
          : await manager.query(
              `SELECT raw FROM wallet_address_transactions
                WHERE "addressId" = $1 AND asset IS NULL
                  AND lower(raw->'transaction'->>'to') = ANY($2::text[])
                ORDER BY "blockHeight", txid`,
              [state.id, pools],
            );
      const sent = rows.flatMap((row) => {
        const found = storedTransaction(row.raw);
        return found && found.tx.from === current.address ? [found] : [];
      });
      await this.insertStake(
        manager,
        current,
        etherStakeMoves(current.address, sent, verified.pools),
      );
      await manager.query(
        'INSERT INTO wallet_stake_scans ("ownerId", "addressId") VALUES ($1, $2)',
        [state.ownerId, state.id],
      );
    });
    return null;
  }

  /**
   * ETH-STAKE-STATE, ETH-STAKE-REWARD: once the history is stored up to `block`, each pool says
   * what the address's share is worth as of that same block. Growth the stored moves and
   * rewards do not explain is a reward, recorded at `block`. Less than they explain means an
   * exit waits in the pool's queue: that ether is still the wallet's until it is claimed.
   * Returns the provider's refusal, if any.
   */
  private async refreshStake(state: ScanRow, block: number): Promise<StepFailure | null> {
    const known: { contract: string; symbol: string | null }[] = await this.source.query(
      `SELECT contract, symbol FROM wallet_ether_stake_positions WHERE "addressId" = $1
        ORDER BY contract`,
      [state.id],
    );
    const readings: { contract: string; symbol: string | null; units: bigint }[] = [];
    for (const position of known) {
      const read = await this.etherscan.call(
        position.contract,
        balanceOfUnderlyingCall(state.address),
        block,
      );
      if (!read.ok) return read.reason;
      const units = readUint(read.data);
      if (units === null) return 'invalid_response';
      let symbol = position.symbol;
      if (symbol === null) {
        const named = await this.etherscan.call(position.contract, symbolCall(), block);
        if (!named.ok) return named.reason;
        symbol = readSymbol(named.data);
      }
      readings.push({ contract: position.contract, symbol, units });
    }
    if (readings.length === 0) return null;
    await this.source.transaction('READ COMMITTED', async (manager) => {
      const [current]: ScanRow[] = await manager.query(
        `SELECT ${scanColumns} FROM wallet_addresses
          WHERE "ownerId" = $1 AND id = $2 AND "removedAt" IS NULL FOR UPDATE`,
        [state.ownerId, state.id],
      );
      if (!current) throw new NotFoundException();
      // Another pass stored more since: these readings no longer match the stored history.
      if (current.scannedBlock !== block) return;
      const explained: { contract: string; units: string }[] = await manager.query(
        `SELECT contract, sum(units)::text AS units FROM (
            SELECT contract, units FROM wallet_ether_stake_moves WHERE "addressId" = $1
            UNION ALL
            SELECT contract, units FROM wallet_ether_stake_rewards WHERE "addressId" = $1
          ) stake GROUP BY contract`,
        [state.id],
      );
      const held = new Map(explained.map((row) => [row.contract, BigInt(row.units)]));
      for (const item of readings) {
        await manager.query(
          `UPDATE wallet_ether_stake_positions SET units = $3::numeric, symbol = $4,
            "observedBlock" = $5, "observedAt" = clock_timestamp()
            WHERE "addressId" = $1 AND contract = $2`,
          [state.id, item.contract, item.units.toString(), item.symbol, block],
        );
        const reward = item.units - (held.get(item.contract) ?? 0n);
        if (reward <= 0n) continue;
        await manager.query(
          `INSERT INTO wallet_ether_stake_rewards ("ownerId", "addressId", contract,
            "blockHeight", "observedAt", units) VALUES ($1, $2, $3, $4, clock_timestamp(),
            $5::numeric) ON CONFLICT ("addressId", contract, "blockHeight") DO NOTHING`,
          [state.ownerId, state.id, item.contract, block, reward.toString()],
        );
      }
    });
    return null;
  }
}
