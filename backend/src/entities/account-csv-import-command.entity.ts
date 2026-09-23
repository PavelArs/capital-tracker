import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('account_csv_import_commands')
export class AccountCsvImportCommand {
  @PrimaryColumn('uuid')
  ownerId!: string;

  @PrimaryColumn('uuid')
  accountId!: string;

  @PrimaryColumn('uuid')
  requestId!: string;

  @Column('uuid')
  batchId!: string;

  @Column('text')
  kind!: 'confirm' | 'rollback';

  @Column({ type: 'text', select: false })
  canonicalPayload!: string;

  @Column('integer')
  rowCount!: number;

  @Column('integer')
  firstJournalRevision!: number;

  @Column('integer')
  lastJournalRevision!: number;

  @Column({ type: 'timestamptz', precision: 3, default: () => 'clock_timestamp()' })
  createdAt!: Date;
}
