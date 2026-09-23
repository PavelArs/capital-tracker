import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('portfolio_flow_versions')
export class PortfolioFlowVersion {
  @PrimaryColumn('uuid')
  ownerId!: string;

  @PrimaryColumn('uuid')
  flowId!: string;

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

  @Column('text')
  direction!: 'contribution' | 'withdrawal';

  @Column({ type: 'timestamptz', precision: 3 })
  occurredAt!: Date;

  @Column({ type: 'numeric', precision: 78, scale: 30 })
  amountUsd!: string;

  @Column({ type: 'timestamptz', precision: 3, default: () => 'clock_timestamp()' })
  createdAt!: Date;

  @Column({ type: 'integer', nullable: true })
  previousVersion!: number | null;
}
