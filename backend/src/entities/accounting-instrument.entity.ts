import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('accounting_instruments')
export class AccountingInstrument {
  @PrimaryColumn('uuid')
  id!: string;

  @Column('uuid')
  ownerId!: string;

  @Column('uuid')
  requestId!: string;

  @Column('text')
  canonicalPayload!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  symbol!: string | null;

  @Column({ type: 'text', default: 'manual' })
  namespace!: 'manual';

  @Column({ type: 'text', default: 'manual' })
  assetType!: 'crypto' | 'fiat' | 'manual';

  @Column({ type: 'text', default: 'USD' })
  valuationCurrency!: 'USD' | 'EUR' | 'RUB';

  @Column({ type: 'text', default: 'manual' })
  priceSource!: 'market' | 'manual' | 'fixed';

  @Column({ type: 'timestamptz', precision: 3, default: () => 'clock_timestamp()' })
  createdAt!: Date;
}
