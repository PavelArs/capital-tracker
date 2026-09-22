import { Check, Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { User } from './user.entity';

@Entity('owner_auth')
@Check('owner_auth_singleton', 'id = 1')
export class OwnerAuth {
  @PrimaryColumn({ type: 'smallint' })
  id!: number;

  @Column({ type: 'uuid', unique: true })
  userId!: string;

  @Column({ type: 'uuid' })
  credentialVersion!: string;

  @OneToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'userId' })
  user!: User;
}
