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

export enum BankType {
  CHASE = 'chase',
  BANK_OF_AMERICA = 'bank_of_america',
  WELLS_FARGO = 'wells_fargo',
  CITIBANK = 'citibank',
  CAPITAL_ONE = 'capital_one',
  OPEN_BANKING = 'open_banking', // Open Banking API
  CUSTOM = 'custom',
}

export enum IntegrationStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ERROR = 'error',
}

@Entity('bank_integrations')
export class BankIntegration {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: string;

  @Column({
    type: 'enum',
    enum: BankType,
  })
  bankType: BankType;

  @Column()
  name: string;

  @Column({
    type: 'enum',
    enum: IntegrationStatus,
    default: IntegrationStatus.INACTIVE,
  })
  status: IntegrationStatus;

  @Column('jsonb', { nullable: true })
  credentials: any; // Encrypted credentials (API keys, tokens, etc.)

  @Column('jsonb', { nullable: true })
  config: any; // Additional configuration

  @Column({ nullable: true, type: 'text' })
  errorMessage: string;

  @Column({ type: 'timestamp', nullable: true })
  lastSyncAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
