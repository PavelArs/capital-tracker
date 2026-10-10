import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  GoneException,
  HttpException,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { UserWithoutPassword } from './auth.service';
import {
  createTotp,
  MfaCipher,
  MfaEnvelope,
  newRecoveryCodes,
  recoveryHash,
  recoveryPattern,
} from './mfa-crypto';
import { recordFailure, streakLocked } from './mfa-failures';
import { hashPassword, validPasswordInput, verifyPassword } from './password';
import { SessionService } from './session.service';

interface FactorRow {
  userId: string;
  activeVersion: string | null;
  activeEnvelope: MfaEnvelope | null;
  lastCounter: string | null;
  candidateId: string | null;
  candidateEnvelope: MfaEnvelope | null;
  candidateExpiresAt: Date | null;
  candidateAttempts: number;
  failedAttempts: number;
  failureWindowStart: Date | null;
  blockedUntil: Date | null;
  consecutiveFailures: number;
}
interface OwnerRow {
  userId: string;
  credentialVersion: string;
}
export interface FactorInput {
  kind: 'totp' | 'recovery';
  code: string;
}
export interface EnrollmentOutput {
  uri: string;
  candidateId: string;
  expiresAt: string;
}
export interface RecoveryOutput {
  recoveryCodes: string[];
}
export interface RecoveryStatus {
  unused: number;
  total: number;
}
// SEC-TOTP: a new authenticator waiting for its first code; the key is shown only now.
export interface ReplacementOutput extends EnrollmentOutput {
  secret: string;
}

const validFactor = (input: FactorInput | undefined): input is FactorInput =>
  !!input &&
  typeof input.code === 'string' &&
  (input.kind === 'totp'
    ? /^[0-9]{6}$/.test(input.code)
    : input.kind === 'recovery' && recoveryPattern.test(input.code));

@Injectable()
export class MfaService implements OnModuleInit {
  private readonly cipher: MfaCipher;
  constructor(
    private readonly source: DataSource,
    config: ConfigService,
    private readonly sessions: SessionService,
  ) {
    this.cipher = new MfaCipher(config);
  }

  async onModuleInit(): Promise<void> {
    const rows: FactorRow[] = await this.source.query(
      'SELECT * FROM owner_mfa WHERE "activeVersion" IS NOT NULL',
    );
    for (const row of rows) this.cipher.decrypt(row.activeEnvelope, row.userId, row.activeVersion!);
  }

  private async owner(manager: EntityManager): Promise<OwnerRow> {
    await manager.query("SET LOCAL lock_timeout = '5s'");
    const [owner] = await manager.query('SELECT * FROM owner_auth WHERE id = 1 FOR UPDATE');
    if (!owner) throw new UnauthorizedException();
    return owner;
  }

  private async factor(manager: EntityManager, userId: string): Promise<FactorRow | undefined> {
    const [factor] = await manager.query(
      'SELECT * FROM owner_mfa WHERE id = 1 AND "userId" = $1 FOR UPDATE',
      [userId],
    );
    return factor;
  }

  private counter(
    envelope: unknown,
    userId: string,
    version: string,
    code: string,
    now: Date,
  ): number | null {
    const totp = createTotp(this.cipher.decrypt(envelope, userId, version));
    const delta = totp.validate({ token: code, timestamp: now.getTime(), window: 1 });
    return delta === null ? null : Math.floor(now.getTime() / 30000) + delta;
  }

  async prepareEnrollment(
    userId: string,
    replace: boolean,
    publish: (value: EnrollmentOutput) => void,
  ): Promise<void> {
    await this.source.transaction(async (manager) => {
      const owner = await this.owner(manager);
      if (owner.userId !== userId) throw new UnauthorizedException();
      const current = await this.factor(manager, userId);
      if (current?.activeVersion && !replace)
        throw new Error('Active factor requires explicit replacement');
      const totp = createTotp();
      const candidateId = randomUUID();
      const envelope = this.cipher.encrypt(totp.secret.base32, userId, candidateId);
      const [row] = await manager.query(
        `INSERT INTO owner_mfa (id, "userId", "candidateId", "candidateEnvelope", "candidateExpiresAt")
        VALUES (1, $1, $2, $3, clock_timestamp() + interval '10 minutes')
        ON CONFLICT (id) DO UPDATE SET "candidateId" = EXCLUDED."candidateId",
          "candidateEnvelope" = EXCLUDED."candidateEnvelope", "candidateExpiresAt" = EXCLUDED."candidateExpiresAt", "candidateAttempts" = 0
        RETURNING "candidateExpiresAt"`,
        [userId, candidateId, envelope],
      );
      // Last operation before COMMIT: publication failure must roll back the candidate.
      publish({
        uri: totp.toString(),
        candidateId,
        expiresAt: row.candidateExpiresAt.toISOString(),
      });
    });
  }

  async confirmEnrollment(
    userId: string,
    candidateId: string,
    code: string,
    publish: (value: RecoveryOutput) => void,
  ): Promise<boolean> {
    if (typeof code !== 'string' || !/^[0-9]{6}$/.test(code)) throw new BadRequestException();
    return this.source.transaction(async (manager) => {
      const owner = await this.owner(manager);
      if (owner.userId !== userId) throw new UnauthorizedException();
      const factor = await this.factor(manager, userId);
      await this.sessions.creationLock(manager);
      const [{ now }] = await manager.query('SELECT clock_timestamp() AS now');
      if (
        !factor ||
        factor.candidateId !== candidateId ||
        !factor.candidateExpiresAt ||
        factor.candidateExpiresAt.getTime() <= now.getTime() ||
        factor.candidateAttempts >= 5
      )
        return false;
      const counter = this.counter(factor.candidateEnvelope, userId, candidateId, code, now);
      if (counter === null) {
        await manager.query(
          'UPDATE owner_mfa SET "candidateAttempts" = "candidateAttempts" + 1 WHERE id = 1',
        );
        return false;
      }
      const recoveryCodes = newRecoveryCodes();
      await manager.query(
        `UPDATE owner_mfa SET "activeVersion" = "candidateId", "activeEnvelope" = "candidateEnvelope", "lastCounter" = $1,
        "candidateId" = NULL, "candidateEnvelope" = NULL, "candidateExpiresAt" = NULL, "candidateAttempts" = 0,
        "failedAttempts" = 0, "failureWindowStart" = NULL, "blockedUntil" = NULL,
        "consecutiveFailures" = 0 WHERE id = 1`,
        [counter],
      );
      await manager.query('DELETE FROM owner_mfa_recovery WHERE "userId" = $1', [userId]);
      for (const code of recoveryCodes)
        await manager.query(
          `INSERT INTO owner_mfa_recovery ("codeHash", "userId", "enrollmentVersion") VALUES ($1, $2, $3)`,
          [recoveryHash(code, userId, candidateId), userId, candidateId],
        );
      await manager.query('UPDATE owner_auth SET "credentialVersion" = $1 WHERE id = 1', [
        randomUUID(),
      ]);
      await manager.query('DELETE FROM auth_sessions WHERE "userId" = $1', [userId]);
      const [{ finalNow }] = await manager.query('SELECT clock_timestamp() AS "finalNow"');
      if (
        factor.candidateExpiresAt.getTime() <= finalNow.getTime() ||
        this.counter(factor.candidateEnvelope, userId, candidateId, code, finalNow) !== counter
      ) {
        throw new UnauthorizedException();
      }
      publish({ recoveryCodes });
      return true;
    });
  }

  async complete(
    hash: string,
    input: FactorInput,
    device: string | null = null,
  ): Promise<{ token: string; csrfToken: string; user: UserWithoutPassword }> {
    if (!validFactor(input)) throw new BadRequestException();
    const outcome = await this.source.transaction(async (manager) => {
      const owner = await this.owner(manager);
      const factor = await this.factor(manager, owner.userId);
      if (!factor?.activeVersion) throw new UnauthorizedException();
      await this.sessions.creationLock(manager);
      const pending = await this.sessions.row(manager, hash);
      if (
        !this.sessions.valid(pending) ||
        pending.state !== 'pending_mfa' ||
        pending.userId !== owner.userId ||
        pending.credentialVersion !== owner.credentialVersion
      )
        throw new UnauthorizedException();
      // Lock all rows that issuance/consumption may write before checking the clock.
      // There are at most ten full sessions; failed attempts merely release these locks.
      await manager.query(
        `SELECT "tokenHash" FROM auth_sessions WHERE state = 'authenticated' ORDER BY "tokenHash" FOR UPDATE`,
      );
      if (input.kind === 'recovery')
        await manager.query(
          `SELECT "codeHash" FROM owner_mfa_recovery
        WHERE "codeHash" = $1 AND "userId" = $2 AND "enrollmentVersion" = $3 FOR UPDATE`,
          [
            recoveryHash(input.code, owner.userId, factor.activeVersion),
            owner.userId,
            factor.activeVersion,
          ],
        );
      const [{ now }] = await manager.query('SELECT clock_timestamp() AS now');
      if (pending.expiresAt.getTime() <= now.getTime()) throw new UnauthorizedException();
      if (
        streakLocked(factor) ||
        (factor.blockedUntil && factor.blockedUntil.getTime() > now.getTime())
      )
        return { status: 429 } as const;
      let accepted = false;
      try {
        this.cipher.decrypt(factor.activeEnvelope, owner.userId, factor.activeVersion);
      } catch {
        throw new UnauthorizedException();
      }
      if (input.kind === 'totp') {
        const counter = this.counter(
          factor.activeEnvelope,
          owner.userId,
          factor.activeVersion,
          input.code,
          now,
        );
        if (counter !== null && BigInt(counter) > BigInt(factor.lastCounter!)) {
          await manager.query('UPDATE owner_mfa SET "lastCounter" = $1 WHERE id = 1', [counter]);
          accepted = true;
        }
      } else {
        this.cipher.decrypt(factor.activeEnvelope, owner.userId, factor.activeVersion);
        const rows = await manager.query(
          `UPDATE owner_mfa_recovery SET "usedAt" = $1
          WHERE "codeHash" = $2 AND "userId" = $3 AND "enrollmentVersion" = $4 AND "usedAt" IS NULL RETURNING "codeHash"`,
          [
            now,
            recoveryHash(input.code, owner.userId, factor.activeVersion),
            owner.userId,
            factor.activeVersion,
          ],
        );
        accepted = rows[0].length === 1;
      }
      if (!accepted) {
        const failure = recordFailure(factor, now);
        await manager.query(
          `UPDATE owner_mfa SET "failedAttempts" = $1, "failureWindowStart" = $2, "blockedUntil" = $3,
          "consecutiveFailures" = $4 WHERE id = 1`,
          [
            failure.next.failedAttempts,
            failure.next.failureWindowStart,
            failure.next.blockedUntil,
            failure.next.consecutiveFailures,
          ],
        );
        if (pending.failedAttempts + 1 >= 5)
          await manager.query('DELETE FROM auth_sessions WHERE "tokenHash" = $1', [hash]);
        else
          await manager.query(
            'UPDATE auth_sessions SET "failedAttempts" = "failedAttempts" + 1 WHERE "tokenHash" = $1',
            [hash],
          );
        return { status: failure.status } as const;
      }
      await manager.query(
        `UPDATE owner_mfa SET "failedAttempts" = 0, "failureWindowStart" = NULL, "blockedUntil" = NULL,
        "consecutiveFailures" = 0 WHERE id = 1`,
      );
      const [user]: UserWithoutPassword[] = await manager.query(
        'SELECT id, email, "firstName", "lastName", "createdAt", "updatedAt" FROM users WHERE id = $1',
        [owner.userId],
      );
      return {
        session: await this.sessions.issueAuthenticated(
          manager,
          pending,
          { user, credentialVersion: owner.credentialVersion },
          device,
        ),
      };
    });
    if ('status' in outcome)
      throw new HttpException(
        outcome.status === 429 ? 'Too many attempts' : 'Unauthorized',
        outcome.status!,
      );
    return outcome.session;
  }

  // SEC-CODES: unused codes of the active factor, as Settings shows them.
  async recoveryStatus(userId: string): Promise<RecoveryStatus> {
    const [row] = await this.source.query(
      `SELECT count(*) FILTER (WHERE r."usedAt" IS NULL)::int AS unused, count(r."codeHash")::int AS total
      FROM owner_mfa m LEFT JOIN owner_mfa_recovery r
        ON r."userId" = m."userId" AND r."enrollmentVersion" = m."activeVersion"
      WHERE m.id = 1 AND m."userId" = $1`,
      [userId],
    );
    return { unused: row?.unused ?? 0, total: row?.total ?? 0 };
  }

  // A fresh factor from the signed-in owner: a TOTP step newer than the last one accepted, or an
  // unused recovery code, which is spent. Wrong codes count against the same limits as sign-in,
  // so a stolen cookie cannot guess; they answer 422, not 401, so the browser stays signed in.
  private async proveFactor(
    manager: EntityManager,
    factor: FactorRow & { activeVersion: string },
    input: FactorInput,
    now: Date,
  ): Promise<'accepted' | 422 | 429> {
    if (
      streakLocked(factor) ||
      (factor.blockedUntil && factor.blockedUntil.getTime() > now.getTime())
    )
      return 429;
    let accepted = false;
    if (input.kind === 'totp') {
      const counter = this.counter(
        factor.activeEnvelope,
        factor.userId,
        factor.activeVersion,
        input.code,
        now,
      );
      if (counter !== null && BigInt(counter) > BigInt(factor.lastCounter!)) {
        await manager.query('UPDATE owner_mfa SET "lastCounter" = $1 WHERE id = 1', [counter]);
        accepted = true;
      }
    } else {
      const rows = await manager.query(
        `UPDATE owner_mfa_recovery SET "usedAt" = $1
        WHERE "codeHash" = $2 AND "userId" = $3 AND "enrollmentVersion" = $4 AND "usedAt" IS NULL RETURNING "codeHash"`,
        [
          now,
          recoveryHash(input.code, factor.userId, factor.activeVersion),
          factor.userId,
          factor.activeVersion,
        ],
      );
      accepted = rows[0].length === 1;
    }
    if (accepted) {
      await manager.query(
        `UPDATE owner_mfa SET "failedAttempts" = 0, "failureWindowStart" = NULL, "blockedUntil" = NULL,
        "consecutiveFailures" = 0 WHERE id = 1`,
      );
      return 'accepted';
    }
    const failure = recordFailure(factor, now);
    await manager.query(
      `UPDATE owner_mfa SET "failedAttempts" = $1, "failureWindowStart" = $2, "blockedUntil" = $3,
      "consecutiveFailures" = $4 WHERE id = 1`,
      [
        failure.next.failedAttempts,
        failure.next.failureWindowStart,
        failure.next.blockedUntil,
        failure.next.consecutiveFailures,
      ],
    );
    return failure.status === 429 ? 429 : 422;
  }

  private async activeFactor(
    manager: EntityManager,
    userId: string,
  ): Promise<FactorRow & { activeVersion: string }> {
    const owner = await this.owner(manager);
    if (owner.userId !== userId) throw new UnauthorizedException();
    const factor = await this.factor(manager, userId);
    if (!factor?.activeVersion) throw new UnauthorizedException();
    return factor as FactorRow & { activeVersion: string };
  }

  private async replaceRecoveryCodes(
    manager: EntityManager,
    userId: string,
    version: string,
  ): Promise<string[]> {
    const recoveryCodes = newRecoveryCodes();
    await manager.query('DELETE FROM owner_mfa_recovery WHERE "userId" = $1', [userId]);
    for (const value of recoveryCodes)
      await manager.query(
        `INSERT INTO owner_mfa_recovery ("codeHash", "userId", "enrollmentVersion") VALUES ($1, $2, $3)`,
        [recoveryHash(value, userId, version), userId, version],
      );
    return recoveryCodes;
  }

  // SEC-CODES: a fresh TOTP from the signed-in owner replaces every recovery code at once.
  async regenerateRecoveryCodes(userId: string, code: unknown): Promise<string[]> {
    if (typeof code !== 'string' || !/^[0-9]{6}$/.test(code)) throw new BadRequestException();
    const outcome = await this.source.transaction(async (manager) => {
      const factor = await this.activeFactor(manager, userId);
      const [{ now }] = await manager.query('SELECT clock_timestamp() AS now');
      const proof = await this.proveFactor(manager, factor, { kind: 'totp', code }, now);
      if (proof !== 'accepted') return { status: proof } as const;
      return {
        recoveryCodes: await this.replaceRecoveryCodes(manager, userId, factor.activeVersion),
      };
    });
    if ('status' in outcome) throw this.proofFailure(outcome.status!);
    return outcome.recoveryCodes;
  }

  // SEC-TOTP: after a fresh factor, a new authenticator secret waits ten minutes for its first
  // code. The current authenticator and recovery codes keep working until then.
  async prepareReplacement(userId: string, input: FactorInput): Promise<ReplacementOutput> {
    if (!validFactor(input)) throw new BadRequestException();
    const outcome = await this.source.transaction(async (manager) => {
      const factor = await this.activeFactor(manager, userId);
      const [{ now }] = await manager.query('SELECT clock_timestamp() AS now');
      const proof = await this.proveFactor(manager, factor, input, now);
      if (proof !== 'accepted') return { status: proof } as const;
      const totp = createTotp();
      const candidateId = randomUUID();
      const envelope = this.cipher.encrypt(totp.secret.base32, userId, candidateId);
      // An UPDATE answers [rows, count].
      const [rows] = await manager.query(
        `UPDATE owner_mfa SET "candidateId" = $1, "candidateEnvelope" = $2,
          "candidateExpiresAt" = clock_timestamp() + interval '10 minutes', "candidateAttempts" = 0
        WHERE id = 1 RETURNING "candidateExpiresAt"`,
        [candidateId, envelope],
      );
      return {
        replacement: {
          uri: totp.toString(),
          secret: totp.secret.base32,
          candidateId,
          expiresAt: rows[0].candidateExpiresAt.toISOString(),
        },
      };
    });
    if ('status' in outcome) throw this.proofFailure(outcome.status!);
    return outcome.replacement;
  }

  // SEC-TOTP: the first code from the new authenticator activates it, replaces every recovery
  // code and signs out every other browser; this browser stays signed in.
  async confirmReplacement(
    userId: string,
    currentHash: string,
    candidateId: unknown,
    code: unknown,
  ): Promise<string[]> {
    if (
      typeof candidateId !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(candidateId) ||
      typeof code !== 'string' ||
      !/^[0-9]{6}$/.test(code)
    )
      throw new BadRequestException();
    const outcome = await this.source.transaction(async (manager) => {
      const factor = await this.activeFactor(manager, userId);
      await this.sessions.creationLock(manager);
      const [{ now }] = await manager.query('SELECT clock_timestamp() AS now');
      if (
        factor.candidateId !== candidateId ||
        !factor.candidateExpiresAt ||
        factor.candidateExpiresAt.getTime() <= now.getTime() ||
        factor.candidateAttempts >= 5
      )
        return { status: 410 } as const;
      const counter = this.counter(factor.candidateEnvelope, userId, candidateId, code, now);
      if (counter === null) {
        await manager.query(
          'UPDATE owner_mfa SET "candidateAttempts" = "candidateAttempts" + 1 WHERE id = 1',
        );
        return { status: factor.candidateAttempts + 1 >= 5 ? 410 : 422 } as const;
      }
      await manager.query(
        `UPDATE owner_mfa SET "activeVersion" = "candidateId", "activeEnvelope" = "candidateEnvelope", "lastCounter" = $1,
        "candidateId" = NULL, "candidateEnvelope" = NULL, "candidateExpiresAt" = NULL, "candidateAttempts" = 0,
        "failedAttempts" = 0, "failureWindowStart" = NULL, "blockedUntil" = NULL,
        "consecutiveFailures" = 0 WHERE id = 1`,
        [counter],
      );
      const recoveryCodes = await this.replaceRecoveryCodes(manager, userId, candidateId);
      // A new credential revision ends every other session; this one moves to it.
      const version = randomUUID();
      await manager.query('UPDATE owner_auth SET "credentialVersion" = $1 WHERE id = 1', [version]);
      await manager.query('DELETE FROM auth_sessions WHERE "userId" = $1 AND "tokenHash" <> $2', [
        userId,
        currentHash,
      ]);
      await manager.query(
        'UPDATE auth_sessions SET "credentialVersion" = $1 WHERE "tokenHash" = $2',
        [version, currentHash],
      );
      return { recoveryCodes };
    });
    if ('status' in outcome) {
      if (outcome.status === 410) throw new GoneException('Setup expired');
      throw new UnprocessableEntityException('Invalid code');
    }
    return outcome.recoveryCodes;
  }

  // SEC-PASSWORD: the signed-in owner changes the password with the current one and a fresh
  // TOTP. The factor is checked first, so a stolen session cannot test passwords without it.
  // Every other session ends; this browser moves to the new credential revision.
  async changePassword(
    userId: string,
    currentHash: string,
    input: { currentPassword: unknown; newPassword: unknown; code: unknown },
  ): Promise<void> {
    const { currentPassword, newPassword, code } = input;
    if (typeof code !== 'string' || !/^[0-9]{6}$/.test(code) || typeof currentPassword !== 'string')
      throw new BadRequestException();
    if (!validPasswordInput(newPassword)) {
      throw new BadRequestException('Password must have 15 to 128 characters and no line breaks');
    }
    const outcome = await this.source.transaction(async (manager) => {
      const factor = await this.activeFactor(manager, userId);
      await this.sessions.creationLock(manager);
      const [{ now }] = await manager.query('SELECT clock_timestamp() AS now');
      const proof = await this.proveFactor(manager, factor, { kind: 'totp', code }, now);
      if (proof !== 'accepted') return { status: proof } as const;
      const [user]: { password: string }[] = await manager.query(
        'SELECT password FROM users WHERE id = $1 FOR UPDATE',
        [userId],
      );
      if (!user || !(await verifyPassword(user.password, currentPassword)))
        return { status: 'password' } as const;
      if (currentPassword === newPassword) return { status: 'same' } as const;
      await manager.query(
        'UPDATE users SET password = $1, "resetPasswordToken" = NULL, "resetPasswordExpires" = NULL, "updatedAt" = now() WHERE id = $2',
        [await hashPassword(newPassword), userId],
      );
      const version = randomUUID();
      await manager.query('UPDATE owner_auth SET "credentialVersion" = $1 WHERE id = 1', [version]);
      await manager.query('DELETE FROM auth_sessions WHERE "userId" = $1 AND "tokenHash" <> $2', [
        userId,
        currentHash,
      ]);
      await manager.query(
        'UPDATE auth_sessions SET "credentialVersion" = $1 WHERE "tokenHash" = $2',
        [version, currentHash],
      );
      // A reset link sent before the change must not set the old choice again.
      await manager.query(
        `UPDATE password_reset_tokens SET "revokedAt" = clock_timestamp()
        WHERE "userId" = $1 AND "usedAt" IS NULL AND "revokedAt" IS NULL`,
        [userId],
      );
      return { status: 'changed' } as const;
    });
    if (outcome.status === 'changed') return;
    if (outcome.status === 'password' || outcome.status === 'same')
      throw new UnprocessableEntityException({
        message:
          outcome.status === 'password'
            ? 'The current password is not correct'
            : 'The new password must differ from the current one',
        error: outcome.status,
      });
    throw this.proofFailure(outcome.status);
  }

  private proofFailure(status: 422 | 429): HttpException {
    return status === 429
      ? new HttpException('Too many attempts', 429)
      : new UnprocessableEntityException('Invalid code');
  }
}
