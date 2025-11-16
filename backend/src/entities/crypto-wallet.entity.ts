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

export enum CryptoType {
  BITCOIN = 'bitcoin',
  ETHEREUM = 'ethereum',
  // Additional blockchains for PRO subscription
  POLYGON = 'polygon',
  BINANCE_SMART_CHAIN = 'binance_smart_chain',
  AVALANCHE = 'avalanche',
  SOLANA = 'solana',
  ARBITRUM = 'arbitrum',
  OPTIMISM = 'optimism',
  BASE = 'base',
  CUSTOM = 'custom',
}

@Entity('crypto_wallets')
export class CryptoWallet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: string;

  @Column({
    type: 'enum',
    enum: CryptoType,
  })
  type: CryptoType;

  @Column()
  address: string;

  @Column('decimal', { precision: 30, scale: 18, default: 0 })
  balance: number;

  @Column('jsonb', { nullable: true })
  tokens: any; // For ERC-20 tokens

  @Column({ type: 'timestamp', nullable: true })
  lastUpdated: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

