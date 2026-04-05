import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Currency } from './currency.entity';
import { User } from './user.entity';

@Entity('user_currency_preferences')
@Unique(['userId', 'currencyId'])
export class UserCurrencyPreference {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  currencyId: string;

  @ManyToOne(() => Currency, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'currencyId' })
  currency: Currency;

  @Column({ default: false })
  isHidden: boolean; // true = пользователь скрыл эту валюту для себя

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
