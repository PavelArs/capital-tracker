import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { parseDecimal, parseUuid } from '../accounting/input';
import { parseTradeCreate } from '../accounting/trade-input';
import { type TradeReceipt, TradeService } from '../accounting/trade.service';
import { formatSats } from './esplora-client';
import { parseCompletion, parseTxid } from './wallet-address-input';

const alreadyCompleted = () =>
  new ConflictException('Address transaction is already completed by another trade');

@Injectable()
export class WalletAddressTradeService {
  constructor(
    private readonly source: DataSource,
    private readonly trades: TradeService,
  ) {}

  // Records the purchase behind an incoming transaction as an ordinary journal buy trade
  // and links the two in the trade's own database transaction.
  async complete(
    ownerId: string,
    addressId: string,
    txid: string,
    raw: unknown,
  ): Promise<{ created: boolean; value: TradeReceipt }> {
    const owner = parseUuid(ownerId);
    const address = parseUuid(addressId);
    const id = parseTxid(txid);
    const input = parseCompletion(raw);
    const accountId = parseUuid(input.accountId);
    const trade = parseTradeCreate(input.trade);
    const [row]: { direction: string; receivedUnits: string; sentUnits: string }[] =
      await this.source.query(
        `SELECT t.direction, t."receivedUnits"::text AS "receivedUnits", t."sentUnits"::text AS "sentUnits"
          FROM wallet_address_transactions t
          JOIN wallet_addresses a ON a.id = t."addressId" AND a."ownerId" = $1
          WHERE t."addressId" = $2 AND t.txid = $3`,
        [owner, address, id],
      );
    if (!row) throw new NotFoundException();
    const net = BigInt(row.receivedUnits) - BigInt(row.sentUnits);
    if (
      row.direction !== 'in' ||
      net <= 0n ||
      trade.side !== 'buy' ||
      trade.quantity !== parseDecimal(formatSats(net), true)
    )
      throw new UnprocessableEntityException(
        'Only an incoming transaction can be completed, as a buy of exactly the received amount',
      );
    const result = await this.trades.create(
      owner,
      accountId,
      input.trade,
      // Runs under the owner's accounting lock, which journal voids also take, so the
      // check and the insert cannot race another completion or a void.
      async (manager, receipt) => {
        const [active]: unknown[] = await manager.query(
          `SELECT 1 FROM wallet_address_trade_links l
            JOIN account_trades h ON h."ownerId" = l."ownerId" AND h."accountId" = l."accountId"
              AND h.id = l."tradeId"
            JOIN account_trade_versions v ON v."ownerId" = h."ownerId" AND v."accountId" = h."accountId"
              AND v."tradeId" = h.id AND v.version = h."currentVersion"
            WHERE l."addressId" = $1 AND l.txid = $2 AND v.kind <> 'void'`,
          [address, id],
        );
        if (active) throw alreadyCompleted();
        await manager.query(
          `INSERT INTO wallet_address_trade_links ("ownerId", "addressId", txid, "accountId", "tradeId")
            VALUES ($1, $2, $3, $4, $5)`,
          [owner, address, id, accountId, receipt.trade.tradeId],
        );
      },
    );
    if (!result.created) {
      // A replayed request id must belong to this transaction's own completion.
      const [link]: unknown[] = await this.source.query(
        `SELECT 1 FROM wallet_address_trade_links
          WHERE "addressId" = $1 AND txid = $2 AND "accountId" = $3 AND "tradeId" = $4`,
        [address, id, accountId, result.value.trade.tradeId],
      );
      if (!link) throw alreadyCompleted();
    }
    return result;
  }
}
