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

export enum BrokerType {
  INTERACTIVE_BROKERS = 'interactive_brokers',
  TD_AMERITRADE = 'td_ameritrade',
  CHARLES_SCHWAB = 'charles_schwab',
  E_TRADE = 'e_trade',
  ROBINHOOD = 'robinhood',
  CUSTOM = 'custom',
}

export enum IntegrationStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ERROR = 'error',
}

@Entity('broker_integrations')
export class BrokerIntegration {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: string;

  @Column({
    type: 'enum',
    enum: BrokerType,
  })
  brokerType: BrokerType;

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

