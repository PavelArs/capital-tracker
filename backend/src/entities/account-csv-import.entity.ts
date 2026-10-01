import { Column, Entity, PrimaryColumn } from 'typeorm';
import type { CsvBatchState, CsvSettings } from '../accounting/csv-input';

@Entity('account_csv_imports')
export class AccountCsvImport {
  @PrimaryColumn('uuid')
  id!: string;

  @Column('uuid')
  ownerId!: string;

  @Column('uuid')
  accountId!: string;

  @Column('text')
  sha256!: string;

  @Column({ type: 'bytea', select: false })
  originalBytes!: Buffer;

  @Column('integer')
  byteLength!: number;

  @Column('text')
  filename!: string;

  @Column('text')
  state!: CsvBatchState;

  @Column({ type: 'jsonb', nullable: true })
  acceptedSettings!: (CsvSettings & { parserVersion: string }) | null;

  @Column({ type: 'timestamptz', precision: 3, default: () => 'clock_timestamp()' })
  createdAt!: Date;
}
