import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('account_trades')
export class AccountTrade {
  @PrimaryColumn('uuid')
  id!: string;

  @Column('uuid')
  ownerId!: string;

  @Column('uuid')
  accountId!: string;

  @Column('integer')
  currentVersion!: number;

  @Column({ type: 'timestamptz', precision: 3, default: () => 'clock_timestamp()' })
  createdAt!: Date;
}
