import { randomBytes } from 'node:crypto';
import { Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isEmail } from 'class-validator';
import { Repository } from 'typeorm';
import { OwnerAuth } from '../entities/owner-auth.entity';
import { User } from '../entities/user.entity';
import { hashPassword, validPasswordInput, verifyPassword } from './password';

export interface UserWithoutPassword {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ValidatedOwner {
  user: UserWithoutPassword;
  credentialVersion: string;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyHash = '';

  constructor(
    @InjectRepository(OwnerAuth) private readonly ownerRepository: Repository<OwnerAuth>,
  ) {}

  async onModuleInit(): Promise<void> {
    this.dummyHash = await hashPassword(randomBytes(32).toString('base64url'));
  }

  private currentOwner(): Promise<OwnerAuth | null> {
    return this.ownerRepository.findOne({ where: { id: 1 }, relations: { user: true } });
  }

  async validateUser(email: unknown, password: unknown): Promise<ValidatedOwner | null> {
    // Bound inputs at the service boundary before any expensive password work.
    if (typeof email !== 'string' || email.length > 254 || !validPasswordInput(password))
      return null;
    const normalizedEmail = email.trim().toLowerCase();
    if (!isEmail(normalizedEmail)) return null;
    const owner = await this.currentOwner();
    const matches = owner?.user.email.toLowerCase() === normalizedEmail;
    const verified = await verifyPassword(
      matches && owner ? owner.user.password : this.dummyHash,
      password,
    );
    if (!owner || !matches || !verified) return null;
    return { user: this.projectUser(owner.user), credentialVersion: owner.credentialVersion };
  }

  async getProfile(userId: string): Promise<UserWithoutPassword> {
    const owner = await this.currentOwner();
    if (!owner || owner.userId !== userId) throw new UnauthorizedException();
    return this.projectUser(owner.user);
  }

  private projectUser(user: User): UserWithoutPassword {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
