import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('account_trade_journals')
export class AccountTradeJournal {
  @PrimaryColumn('uuid')
  ownerId!: string;

  @PrimaryColumn('uuid')
  accountId!: string;

  @Column('uuid')
  requestId!: string;

  @Column('text')
  canonicalPayload!: string;

  @Column('text')
  originKind!: 'declared-empty' | 'known-cost-carry-in';

  @Column({ type: 'integer', nullable: true })
  openingRevision!: number | null;

  @Column({ type: 'timestamptz', precision: 3 })
  coverageFrom!: Date;

  @Column({ type: 'timestamptz', precision: 3, default: () => 'clock_timestamp()' })
  createdAt!: Date;

  @Column({ type: 'integer', default: 0 })
  currentRevision!: number;
}
