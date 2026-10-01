import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('account_carry_in_lots')
export class AccountCarryInLot {
  @PrimaryColumn('uuid')
  id!: string;

  @Column('uuid')
  ownerId!: string;

  @Column('uuid')
  accountId!: string;

  @Column('integer')
  openingRevision!: number;

  @Column('integer')
  ordinal!: number;

  @Column('uuid')
  instrumentId!: string;

  @Column({ type: 'timestamptz', precision: 3 })
  acquiredAt!: Date;

  @Column('integer')
  orderWithinTimestamp!: number;

  @Column({ type: 'numeric', precision: 78, scale: 30 })
  originalQuantity!: string;

  @Column({ type: 'numeric', precision: 78, scale: 30 })
  originalCostUsd!: string;

  // Immutable inventory at the opening boundary, not current unconsumed inventory.
  @Column({ type: 'numeric', precision: 78, scale: 30 })
  remainingQuantity!: string;

  @Column({ type: 'timestamptz', precision: 3, default: () => 'clock_timestamp()' })
  createdAt!: Date;
}
