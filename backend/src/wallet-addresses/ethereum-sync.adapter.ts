import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { networkAssets } from './chain-assets';
import type { ChainSyncAdapter, StepFailure, StepResult } from './chain-sync';
import { type EthereumLeg, ethereumLegs, rangeEnd } from './ethereum-legs';
import { EtherscanClient } from './etherscan-client';

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
    const started = Date.now();
    for (let ranges = 0; ; ranges++) {
      const from = (state.scannedBlock ?? -1) + 1;
      // Nothing final since the last pass: the stored history is complete as it is.
      if (from > target) {
        await this.commit(state, [], state.scannedBlock ?? target, true);
        return finish('complete', null);
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
      const committed = await this.commit(state, legs, end, end === target);
      imported += committed.inserted;
      if (end === target) return finish('complete', null);
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
  private commit(expected: ScanRow, legs: EthereumLeg[], end: number, caughtUp: boolean) {
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
}
