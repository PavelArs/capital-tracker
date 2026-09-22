import { randomUUID } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { OwnerAuth } from '../entities/owner-auth.entity';
import { User } from '../entities/user.entity';
import { AuthService } from './auth.service';
import { hashPassword, validPasswordInput, verifyPassword } from './password';

describe('OWN-002/003 owner credentials and revision checks', () => {
  it('rejects malformed Unicode instead of merging distinct password bytes', async () => {
    for (const password of ['abcdefghijklmnop\ud800', 'abcdefghijklmnop\udc00']) {
      expect(validPasswordInput(password)).toBe(false);
      await expect(hashPassword(password)).rejects.toThrow('Invalid password input');
    }
    expect(validPasswordInput('abcdefghijklmnop\ufffd')).toBe(true);
    expect(validPasswordInput('abcdefghijklmnop🔐')).toBe(true);
  });
  const password = '  Exact Unicode Пароль 🔐 42!  ';
  const userId = '11111111-1111-4111-8111-111111111111';
  const revision = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const repository = { findOne: jest.fn() };
  const service = new AuthService(repository as unknown as Repository<OwnerAuth>);
  let owner: OwnerAuth;

  beforeAll(async () => {
    await service.onModuleInit();
    owner = {
      id: 1,
      userId,
      credentialVersion: revision,
      user: {
        id: userId,
        email: 'owner@example.invalid',
        password: await hashPassword(password),
        firstName: null,
        lastName: null,
        emailVerified: true,
        emailVerificationToken: 'private-old-token',
        resetPasswordToken: 'private-old-reset',
        resetPasswordExpires: null,
        createdAt: new Date('2026-09-21'),
        updatedAt: new Date('2026-09-21'),
      } as User,
    };
  });

  beforeEach(() => {
    repository.findOne.mockReset().mockResolvedValue(owner);
  });

  it('verifies exact Unicode and whitespace through Argon2id without leaking credentials in profile', async () => {
    const validated = await service.validateUser(' OWNER@EXAMPLE.INVALID ', password);
    expect(validated).not.toBeNull();
    const result = validated!;
    expect(Object.keys(result.user).sort()).toEqual([
      'createdAt',
      'email',
      'firstName',
      'id',
      'lastName',
      'updatedAt',
    ]);
    expect(JSON.stringify(result.user)).not.toContain('private-');
    expect(await service.validateUser(owner.user.email, password.trim())).toBeNull();
  });

  it('does not accept bcrypt or malformed stored hashes', async () => {
    expect(await verifyPassword('$2b$synthetic-legacy-placeholder', password)).toBe(false);
    expect(await verifyPassword('$argon2id$malformed', password)).toBe(false);
  });

  it.each([
    undefined,
    null,
    {},
    '',
    'short',
    'x'.repeat(129),
    'x'.repeat(513),
    'valid-password-with\nnewline',
  ])('bounds invalid password input before database work (%p)', async (value) => {
    expect(await service.validateUser(owner.user.email, value)).toBeNull();
    expect(repository.findOne).not.toHaveBeenCalled();
  });

  it.each([undefined, null, {}, 'not-email', 'a'.repeat(255)])(
    'bounds invalid email before database work (%p)',
    async (value) => {
      expect(await service.validateUser(value, password)).toBeNull();
      expect(repository.findOne).not.toHaveBeenCalled();
    },
  );

  it('rejects wrong credentials and absent binding', async () => {
    expect(await service.validateUser('foreign@example.invalid', password)).toBeNull();
    expect(await service.validateUser(owner.user.email, 'different-password-42!')).toBeNull();
    repository.findOne.mockResolvedValue(null);
    expect(await service.validateUser(owner.user.email, password)).toBeNull();
  });

  it('rejects nonowner profiles', async () => {
    await expect(service.getProfile(randomUUID())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('counts Unicode code points and preserves maximum-length passwords', () => {
    expect(validPasswordInput('🔐'.repeat(128))).toBe(true);
    expect(validPasswordInput('🔐'.repeat(129))).toBe(false);
    expect(validPasswordInput('x'.repeat(15))).toBe(true);
    expect(validPasswordInput('x'.repeat(14))).toBe(false);
    expect(validPasswordInput('valid-password-\0xx')).toBe(false);
  });
});
