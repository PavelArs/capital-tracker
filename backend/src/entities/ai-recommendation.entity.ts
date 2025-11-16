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

export enum RecommendationType {
  INVESTMENT = 'investment',
  DIVERSIFICATION = 'diversification',
  RISK_MANAGEMENT = 'risk_management',
  ASSET_ALLOCATION = 'asset_allocation',
  DEBT_MANAGEMENT = 'debt_management',
  TAX_OPTIMIZATION = 'tax_optimization',
  OTHER = 'other',
}

export enum RecommendationStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  IMPLEMENTED = 'implemented',
}

@Entity('ai_recommendations')
export class AiRecommendation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: string;

  @Column({
    type: 'enum',
    enum: RecommendationType,
  })
  type: RecommendationType;

  @Column({ type: 'text' })
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column('jsonb', { nullable: true })
  data: any; // Additional structured data

  @Column({
    type: 'enum',
    enum: RecommendationStatus,
    default: RecommendationStatus.PENDING,
  })
  status: RecommendationStatus;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  priority: number; // 0-10 priority score

  @Column({ type: 'timestamp', nullable: true })
  reviewedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

