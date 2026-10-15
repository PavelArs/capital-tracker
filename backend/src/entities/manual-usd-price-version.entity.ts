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

  /** The price in `quoteCurrency`; the column name predates hand values in RUB and EUR. */
  @Column({ type: 'numeric', precision: 78, scale: 30, nullable: true })
  priceUsd!: string | null;

  @Column({ type: 'text', default: 'USD' })
  quoteCurrency!: 'USD' | 'EUR' | 'RUB';

  @Column({ type: 'timestamptz', precision: 3, default: () => 'clock_timestamp()' })
  createdAt!: Date;
}
