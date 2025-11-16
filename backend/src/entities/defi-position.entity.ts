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

export enum DeFiPlatform {
  UNISWAP = 'uniswap',
  AAVE = 'aave',
  COMPOUND = 'compound',
  CURVE = 'curve',
  BALANCER = 'balancer',
  SUSHISWAP = 'sushiswap',
  PANCAKESWAP = 'pancakeswap',
  CUSTOM = 'custom',
}

export enum PositionType {
  LIQUIDITY_POOL = 'liquidity_pool',
  LENDING = 'lending',
  STAKING = 'staking',
  YIELD_FARMING = 'yield_farming',
  OTHER = 'other',
}

@Entity('defi_positions')
export class DeFiPosition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: string;

  @Column({
    type: 'enum',
    enum: DeFiPlatform,
  })
  platform: DeFiPlatform;

  @Column({
    type: 'enum',
    enum: PositionType,
  })
  positionType: PositionType;

  @Column()
  name: string;

  @Column('jsonb', { nullable: true })
  positionData: any; // Platform-specific position data

  @Column('decimal', { precision: 30, scale: 18, default: 0 })
  value: number;

  @Column('decimal', { precision: 10, scale: 4, nullable: true })
  apy: number; // Annual Percentage Yield

  @Column({ nullable: true, type: 'text' })
  description: string;

  @Column({ type: 'timestamp', nullable: true })
  lastUpdated: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

