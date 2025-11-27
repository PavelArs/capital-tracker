import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  OneToOne,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { Subscription, SubscriptionType } from './subscription.entity';
import { Capital } from './capital.entity';
import { InvitationCode } from './invitation-code.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  email!: string;

  @Column()
  @Exclude()
  password!: string;

  @Column({ nullable: true, type: 'varchar' })
  firstName!: string | null;

  @Column({ nullable: true, type: 'varchar' })
  lastName!: string | null;

  @Column({
    type: 'enum',
    enum: SubscriptionType,
    default: SubscriptionType.FREE,
  })
  subscriptionType!: SubscriptionType;

  @Column({ default: false })
  emailVerified!: boolean;

  @Column({ nullable: true, type: 'varchar' })
  emailVerificationToken!: string | null;

  @Column({ nullable: true, type: 'varchar' })
  resetPasswordToken!: string | null;

  @Column({ nullable: true, type: 'timestamp' })
  resetPasswordExpires!: Date | null;

  @OneToMany(() => Subscription, (subscription) => subscription.user)
  subscriptions!: Subscription[];

  @OneToMany(() => Capital, (capital) => capital.user)
  capitals!: Capital[];

  @OneToMany(() => InvitationCode, (invitationCode) => invitationCode.createdBy)
  generatedInvitationCodes!: InvitationCode[];

  @OneToOne(() => InvitationCode, (invitationCode) => invitationCode.usedBy)
  usedInvitationCode!: InvitationCode;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
