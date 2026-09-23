import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('account_csv_import_rows')
export class AccountCsvImportRow {
  @PrimaryColumn('uuid')
  ownerId!: string;

  @PrimaryColumn('uuid')
  accountId!: string;

  @PrimaryColumn('uuid')
  batchId!: string;

  @PrimaryColumn('integer')
  ordinal!: number;

  @Column('integer')
  startLine!: number;

  @Column('uuid')
  tradeId!: string;

  @Column('integer')
  createVersion!: number;

  @Column({ type: 'integer', nullable: true })
  rollbackVersion!: number | null;
}
