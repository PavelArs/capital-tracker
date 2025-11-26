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
import { Currency } from "./currency.entity";

export enum LiabilityCategory {
  SUBSCRIPTIONS = "subscriptions",
  REGULAR_EXPENSES = "regular_expenses",
  LOANS = "loans",
  MORTGAGE = "mortgage",
  CREDIT_CARD = "credit_card",
  OTHER = "other",
}

export enum LiabilityFrequency {
  DAILY = "daily",
  WEEKLY = "weekly",
  MONTHLY = "monthly",
  QUARTERLY = "quarterly",
  YEARLY = "yearly",
}

@Entity("liabilities")
export class Liability {
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
    enum: LiabilityCategory,
  })
  category: LiabilityCategory;

  @Column("decimal", { precision: 20, scale: 8 })
  amount: number;

  @ManyToOne(() => Currency)
  @JoinColumn({ name: "currencyId" })
  currency: Currency;

  @Column()
  currencyId: string;

  @Column({ type: "date" })
  date: Date;

  @Column({ nullable: true, type: "text" })
  description: string;

  @Column({
    type: "enum",
    enum: LiabilityFrequency,
    nullable: true,
  })
  frequency: LiabilityFrequency | null;

  @Column({ nullable: true, type: "date" })
  deadline: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
