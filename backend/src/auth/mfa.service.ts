import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  HttpException,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
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
  ): Promise<{ token: string; csrfToken: string; user: UserWithoutPassword }> {
    if (
      !input ||
      typeof input.code !== 'string' ||
      !(input.kind === 'totp'
        ? /^[0-9]{6}$/.test(input.code)
        : input.kind === 'recovery' && recoveryPattern.test(input.code))
    )
      throw new BadRequestException();
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
        session: await this.sessions.issueAuthenticated(manager, pending, {
          user,
          credentialVersion: owner.credentialVersion,
        }),
      };
    });
    if ('status' in outcome)
      throw new HttpException(
        outcome.status === 429 ? 'Too many attempts' : 'Unauthorized',
        outcome.status!,
      );
    return outcome.session;
  }
}
