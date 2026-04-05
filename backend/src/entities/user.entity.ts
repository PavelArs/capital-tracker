import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Exclude } from 'class-transformer';

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

  @Column({ default: false })
  emailVerified!: boolean;

  @Column({ nullable: true, type: 'varchar' })
  emailVerificationToken!: string | null;

  @Column({ nullable: true, type: 'varchar' })
  resetPasswordToken!: string | null;

  @Column({ nullable: true, type: 'timestamp' })
  resetPasswordExpires!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
