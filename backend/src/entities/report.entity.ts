import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Capital } from './capital.entity';

export enum ReportType {
  FINANCIAL_SUMMARY = 'financial_summary',
  ASSET_ALLOCATION = 'asset_allocation',
  PERFORMANCE = 'performance',
  TAX = 'tax',
  CUSTOM = 'custom',
}

export enum ReportFormat {
  PDF = 'pdf',
  EXCEL = 'excel',
  CSV = 'csv',
  JSON = 'json',
}

@Entity('reports')
export class Report {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: string;

  @ManyToOne(() => Capital, { nullable: true })
  @JoinColumn({ name: 'capitalId' })
  capital: Capital;

  @Column({ nullable: true })
  capitalId: string;

  @Column({
    type: 'enum',
    enum: ReportType,
  })
  type: ReportType;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({
    type: 'enum',
    enum: ReportFormat,
    default: ReportFormat.PDF,
  })
  format: ReportFormat;

  @Column('jsonb', { nullable: true })
  parameters: any; // Report generation parameters

  @Column('jsonb', { nullable: true })
  data: any; // Generated report data

  @Column({ nullable: true })
  fileUrl: string; // URL to generated file if stored

  @Column({ type: 'timestamp', nullable: true })
  generatedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

