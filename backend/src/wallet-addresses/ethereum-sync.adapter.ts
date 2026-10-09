import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { networkAssets } from './chain-assets';
import type { ChainSyncAdapter, StepFailure, StepResult } from './chain-sync';
import { type EthereumLeg, ethereumLegs, rangeEnd } from './ethereum-legs';
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
import { EtherscanClient, parseInternal, parseNormal } from './etherscan-client';

// Blocks this deep are final; a shallower one could still be replaced and its rows are
// never rewritten, so they wait for the next pass.
export const CONFIRMATIONS = 64;
// Bounds for one pass; the next pass continues from the committed block.
export const MAX_RANGES_PER_SYNC = 10;
const SYNC_TIME_BUDGET_MS = 25_000;
const contracts = networkAssets('ethereum').flatMap((asset) =>
  asset.contract ? [asset.contract] : [],
);

interface ScanRow {
  id: string;
  ownerId: string;
  address: string;
  scannedBlock: number | null;
}

type Pools = { ok: true; pools: Set<string> } | { ok: false; reason: StepFailure };

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

// Ethereum history from Etherscan: block ranges from the last stored block up to a final one,
// each committed with its rows, so an interrupted pass resumes without gaps or duplicates.
@Injectable()
export class EthereumSyncAdapter implements ChainSyncAdapter {
  readonly network = 'ethereum';
  readonly name = 'Ethereum';

  constructor(
    private readonly source: DataSource,
    private readonly etherscan: EtherscanClient,
  ) {}

  async step(ownerId: string, addressId: string): Promise<StepResult> {
    let state = await this.scan(ownerId, addressId);
    let imported = 0;
    const finish = (outcome: StepResult['outcome'], reason: StepFailure | null) => ({
      outcome,
      reason,
      imported,
    });
    if (!this.etherscan.configured) return finish('provider_error', 'not_configured');
    const tip = await this.etherscan.blockNumber();
    if (!tip.ok) return finish('provider_error', tip.reason);
    const target = tip.block - CONFIRMATIONS;
    const backfill = await this.backfillStake(state, target);
    if (backfill) return finish('provider_error', backfill);
    // The pools are read as of the block the stored history ends at.
    const complete = async (at: ScanRow) => {
      const refused = await this.refreshStake(at, at.scannedBlock ?? target);
      return refused ? finish('provider_error', refused) : finish('complete', null);
    };
    const started = Date.now();
    for (let ranges = 0; ; ranges++) {
      const from = (state.scannedBlock ?? -1) + 1;
      // Nothing final since the last pass: the stored history is complete as it is.
      if (from > target) {
        const committed = await this.commit(state, [], [], state.scannedBlock ?? target, true);
        return complete(committed.state);
      }
      if (ranges >= MAX_RANGES_PER_SYNC || Date.now() - started > SYNC_TIME_BUDGET_MS) {
        return finish('partial', null);
      }
      const normal = await this.etherscan.normal(state.address, from, target);
      if (!normal.ok) return finish('provider_error', normal.reason);
      const internal = await this.etherscan.internal(state.address, from, target);
      if (!internal.ok) return finish('provider_error', internal.reason);
      const tokens = await this.etherscan.tokens(state.address, from, target);
      if (!tokens.ok) return finish('provider_error', tokens.reason);
      const end = rangeEnd(from, target, [normal.items, internal.items, tokens.items]);
      if (end === null) return finish('provider_error', 'invalid_response');
      const within = <T extends { blockNumber: number }>(items: T[]) =>
        items.filter((item) => item.blockNumber >= from && item.blockNumber <= end);
      const legs = ethereumLegs(
        state.address,
        within(normal.items),
        within(internal.items),
        within(tokens.items).filter((item) => contracts.includes(item.contract)),
      );
      const sent = etherTransactions(state.address, within(normal.items), within(internal.items));
      const pools = await this.pools(state, sent, target);
      if (!pools.ok) return finish('provider_error', pools.reason);
      const moves = etherStakeMoves(state.address, sent, pools.pools);
      const committed = await this.commit(state, legs, moves, end, end === target);
      imported += committed.inserted;
      if (end === target) return complete(committed.state);
      state = committed.state;
    }
  }

  private async scan(owner: string, id: string): Promise<ScanRow> {
    const [row]: ScanRow[] = await this.source.query(
      `SELECT id, "ownerId", address, "scannedBlock"
        FROM wallet_addresses WHERE "ownerId" = $1 AND id = $2 AND network = 'ethereum'`,
      [owner, id],
    );
    if (!row) throw new NotFoundException();
    return row;
  }

  /** Stores one range's legs and moves the cursor past it in one transaction. */
  private commit(
    expected: ScanRow,
    legs: EthereumLeg[],
    moves: EtherStakeMove[],
    end: number,
    caughtUp: boolean,
  ) {
    return this.source.transaction('READ COMMITTED', async (manager) => {
      const [current]: ScanRow[] = await manager.query(
        `SELECT id, "ownerId", address, "scannedBlock" FROM wallet_addresses
          WHERE "ownerId" = $1 AND id = $2 FOR UPDATE`,
        [expected.ownerId, expected.id],
      );
      if (!current || current.scannedBlock !== expected.scannedBlock) {
        throw new ConflictException('Another sync advanced this address');
      }
      const inserted = await this.insert(manager, current, legs);
      await this.insertStake(manager, current, moves);
      // "completedAt" marks a history read up to a final block: the balance can be shown.
      await manager.query(
        `UPDATE wallet_addresses SET "scannedBlock" = $3,
          "completedAt" = CASE WHEN $4 THEN clock_timestamp() ELSE "completedAt" END
          WHERE "ownerId" = $1 AND id = $2`,
        [current.ownerId, current.id, end, caughtUp],
      );
      return { inserted, state: { ...current, scannedBlock: end } };
    });
  }

  private async insert(manager: EntityManager, address: ScanRow, legs: EthereumLeg[]) {
    if (legs.length === 0) return 0;
    const values: unknown[] = [];
    const rows = legs.map((leg) => {
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
        JSON.stringify(leg.raw),
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
    return inserted.length;
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
        `SELECT id, "ownerId", address, "scannedBlock" FROM wallet_addresses
          WHERE "ownerId" = $1 AND id = $2 FOR UPDATE`,
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
        `SELECT id, "ownerId", address, "scannedBlock" FROM wallet_addresses
          WHERE "ownerId" = $1 AND id = $2 FOR UPDATE`,
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
