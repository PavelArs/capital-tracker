import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('account_opening_snapshots')
export class AccountOpeningSnapshot {
  @PrimaryColumn('uuid')
  ownerId!: string;

  @PrimaryColumn('uuid')
  accountId!: string;

  @PrimaryColumn('integer')
  revision!: number;

  @Column('uuid')
  requestId!: string;

  @Column('text')
  canonicalPayload!: string;

  @Column({ type: 'timestamptz', precision: 3 })
  asOf!: Date;

  @Column({ type: 'timestamptz', precision: 3, default: () => 'clock_timestamp()' })
  createdAt!: Date;
}
