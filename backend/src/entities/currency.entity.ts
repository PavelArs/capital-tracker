import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum CurrencyType {
  FIAT = 'fiat',
  CRYPTO = 'crypto',
  STABLECOIN = 'stablecoin',
}

@Entity('currencies')
export class Currency {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, length: 10 })
  code: string; // USD, EUR, RUB, BTC, ETH, USDT

  @Column()
  name: string; // US Dollar, Euro, Russian Ruble, Bitcoin, Ethereum, Tether

  @Column()
  symbol: string; // $, €, ₽, ₿, Ξ, ₮

  @Column({
    type: 'enum',
    enum: CurrencyType,
    default: CurrencyType.FIAT,
  })
  type: CurrencyType;

  @Column({ default: true })
  isActive: boolean;

  @Column({ default: false })
  isDefault: boolean;

  @Column({ nullable: true, length: 42 })
  contractAddress: string; // Ethereum contract address for ERC-20 tokens (e.g., USDT: 0xdAC17F958D2ee523a2206206994597C13D831ec7)

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

