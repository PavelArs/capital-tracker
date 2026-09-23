import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('account_trade_versions')
export class AccountTradeVersion {
  @PrimaryColumn('uuid')
  ownerId!: string;

  @PrimaryColumn('uuid')
  accountId!: string;

  @PrimaryColumn('uuid')
  tradeId!: string;

  @PrimaryColumn('integer')
  version!: number;

  @Column('integer')
  journalRevision!: number;

  @Column('uuid')
  requestId!: string;

  @Column('text')
  canonicalPayload!: string;

  @Column('text')
  kind!: 'create' | 'correct' | 'void';

  @Column('uuid')
  instrumentId!: string;

  @Column('text')
  side!: 'buy' | 'sell';

  @Column({ type: 'timestamptz', precision: 3 })
  occurredAt!: Date;

  @Column('integer')
  orderWithinTimestamp!: number;

  @Column({ type: 'numeric', precision: 78, scale: 30 })
  quantity!: string;

  @Column({ type: 'numeric', precision: 78, scale: 30 })
  grossUsd!: string;

  @Column({ type: 'numeric', precision: 78, scale: 30 })
  feeUsd!: string;

  @Column({ type: 'timestamptz', precision: 3, default: () => 'clock_timestamp()' })
  createdAt!: Date;
}
