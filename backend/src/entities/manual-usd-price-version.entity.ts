import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('manual_usd_price_versions')
export class ManualUsdPriceVersion {
  @PrimaryColumn('uuid')
  ownerId!: string;

  @PrimaryColumn('uuid')
  instrumentId!: string;

  @PrimaryColumn('integer')
  revision!: number;

  @Column('uuid')
  requestId!: string;

  @Column('text')
  canonicalPayload!: string;

  @Column('text')
  kind!: 'set' | 'void';

  @Column({ type: 'timestamptz', precision: 3 })
  observedAt!: Date;

  @Column({ type: 'numeric', precision: 78, scale: 30, nullable: true })
  priceUsd!: string | null;

  @Column({ type: 'timestamptz', precision: 3, default: () => 'clock_timestamp()' })
  createdAt!: Date;
}
