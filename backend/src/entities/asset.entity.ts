import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { User } from "./user.entity";

export enum AssetType {
  STOCK = "stock", // Балансовые активы (имеют стоимость сейчас)
  FLOW = "flow", // Потоковые доходы (регулярный доход)
}

export enum IncomeType {
  ACTIVE = "active", // Активные доходы (требуют активной работы: salary, freelance)
  PASSIVE = "passive", // Пассивные доходы (не требуют активной работы: dividends, rent_income, pension)
}

export enum AssetCategory {
  // Stock assets (балансовые)
  REAL_ESTATE = "real_estate",
  INVESTMENTS = "investments",
  SAVINGS = "savings",
  CRYPTO = "crypto",
  VEHICLE = "vehicle",
  EQUIPMENT = "equipment",

  // Flow assets (потоковые доходы)
  SALARY = "salary",
  DIVIDENDS = "dividends",
  FREELANCE = "freelance",
  RENT_INCOME = "rent_income",
  PENSION = "pension",

  // Other
  OTHER = "other",
}

@Entity("assets")
export class Asset {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: "userId" })
  user: User;

  @Column()
  userId: string;

  @Column()
  name: string;

  @Column({
    type: "enum",
    enum: AssetType,
    default: AssetType.STOCK,
  })
  assetType: AssetType;

  @Column({
    type: "enum",
    enum: AssetCategory,
  })
  category: AssetCategory;

  @Column({
    type: "enum",
    enum: IncomeType,
    nullable: true,
  })
  incomeType: IncomeType | null; // Только для FLOW активов: active или passive

  @Column("decimal", { precision: 15, scale: 2 })
  amount: number;

  @Column({ length: 3, default: "USD" })
  currency: string;

  @Column({ type: "date" })
  date: Date;

  @Column({ nullable: true, type: "text" })
  description: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
