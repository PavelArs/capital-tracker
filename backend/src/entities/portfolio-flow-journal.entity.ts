import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('portfolio_flow_journals')
export class PortfolioFlowJournal {
  @PrimaryColumn('uuid')
  ownerId!: string;

  @Column('uuid')
  requestId!: string;

  @Column('text')
  canonicalPayload!: string;

  @Column({ type: 'timestamptz', precision: 3 })
  coverageFrom!: Date;

  @Column({ type: 'timestamptz', precision: 3, default: () => 'clock_timestamp()' })
  createdAt!: Date;

  @Column({ type: 'integer', default: 0 })
  currentRevision!: number;
}
