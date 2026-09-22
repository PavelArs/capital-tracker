import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('account_opening_positions')
export class AccountOpeningPosition {
  @PrimaryColumn('uuid')
  ownerId!: string;

  @PrimaryColumn('uuid')
  accountId!: string;

  @PrimaryColumn('integer')
  revision!: number;

  @PrimaryColumn('uuid')
  instrumentId!: string;

  // PostgreSQL exact numerics remain strings at every accounting boundary.
  @Column({ type: 'numeric', precision: 78, scale: 30 })
  quantity!: string;

  @Column('text')
  costStatus!: 'known' | 'unknown';

  @Column({ type: 'numeric', precision: 78, scale: 30, nullable: true })
  totalCostUsd!: string | null;
}
