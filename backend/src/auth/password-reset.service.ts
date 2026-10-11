import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { BadRequestException, GoneException, Injectable, Logger } from '@nestjs/common';
import { isEmail } from 'class-validator';
import { DataSource, EntityManager } from 'typeorm';
import { hashPassword, validPasswordInput } from './password';
import { PasswordResetMailer } from './password-reset-mailer';
import { SessionService } from './session.service';

export type ResetLinkState = 'valid' | 'expired' | 'invalid';
// PR-AUTH-3: a link works once, for 30 minutes (the table's lifetime check).
const LINKS_PER_HOUR = 3;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const digest = (token: string) => createHash('sha256').update(token).digest('hex');

interface LinkRow {
  id: string;
  userId: string;
  expired: boolean;
  finished: boolean;
}

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly source: DataSource,
    private readonly sessions: SessionService,
    private readonly mailer: PasswordResetMailer,
  ) {}

  /**
   * Emails the owner a new single-use link. The answer is the same for every address and
   * never waits for SMTP, so neither its content nor its timing tells whether one was sent.
   */
  async request(email: unknown): Promise<void> {
    const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (normalized.length > 254 || !isEmail(normalized)) return;
    const token = randomBytes(32).toString('base64url');
    const recipient = await this.source.transaction(async (manager) => {
      const [owner]: { userId: string; email: string }[] = await manager.query(
        `SELECT o."userId", u.email FROM owner_auth o JOIN users u ON u.id = o."userId"
        WHERE o.id = 1 FOR UPDATE OF o`,
      );
      await manager.query(
        `DELETE FROM password_reset_tokens WHERE "createdAt" < clock_timestamp() - interval '1 day'`,
      );
      if (!owner || owner.email.toLowerCase() !== normalized) return null;
      const [{ recent }]: { recent: number }[] = await manager.query(
        `SELECT count(*)::int AS recent FROM password_reset_tokens
        WHERE "userId" = $1 AND "createdAt" > clock_timestamp() - interval '1 hour'`,
        [owner.userId],
      );
      // RESET-LIMIT: past the hourly limit the owner gets no more email, and nobody can tell.
      if (recent >= LINKS_PER_HOUR) return null;
      await this.revokeOutstanding(manager, owner.userId);
      await manager.query(
        `WITH moment AS MATERIALIZED (SELECT clock_timestamp() AS now)
        INSERT INTO password_reset_tokens ("userId", "tokenHash", "createdAt", "expiresAt")
        SELECT $1, $2, now, now + interval '30 minutes' FROM moment`,
        [owner.userId, digest(token)],
      );
      return owner.email;
    });
    if (!recipient) return;
    // The fragment never reaches a server log; the page reads it and posts it back.
    const link = `${this.sessions.origin}/password-reset/new#token=${token}`;
    this.mailer.sendPasswordReset(recipient, link).catch(() => {
      this.logger.warn('Password reset email was not sent');
    });
  }

  async status(token: unknown): Promise<ResetLinkState> {
    if (typeof token !== 'string' || !tokenPattern.test(token)) return 'invalid';
    const [link] = await this.source.query(this.linkQuery(''), [digest(token)]);
    return this.state(link);
  }

  /** Sets the new password and signs out every owner session; the factor is untouched. */
  async confirm(token: unknown, password: unknown): Promise<void> {
    const refused = (state: ResetLinkState) =>
      new GoneException({
        message:
          state === 'expired'
            ? 'This reset link has expired'
            : 'This reset link was already used or replaced',
        error: state,
      });
    const before = await this.status(token);
    if (before !== 'valid') throw refused(before);
    if (!validPasswordInput(password)) {
      throw new BadRequestException('Password must have 15 to 128 characters and no line breaks');
    }
    const hash = await hashPassword(password);
    await this.source.transaction(async (manager) => {
      // Same lock order as CLI recovery: the owner, then the link, then the sessions.
      const [owner]: { userId: string }[] = await manager.query(
        'SELECT "userId" FROM owner_auth WHERE id = 1 FOR UPDATE',
      );
      const [link] = await manager.query(this.linkQuery('FOR UPDATE'), [digest(token as string)]);
      const state = this.state(link);
      if (state !== 'valid') throw refused(state);
      if (!owner || owner.userId !== link.userId) throw refused('invalid');
      await manager.query(
        `UPDATE users SET password = $1, "resetPasswordToken" = NULL,
        "resetPasswordExpires" = NULL, "updatedAt" = now() WHERE id = $2`,
        [hash, owner.userId],
      );
      await manager.query('UPDATE owner_auth SET "credentialVersion" = $1 WHERE id = 1', [
        randomUUID(),
      ]);
      await manager.query('DELETE FROM auth_sessions WHERE "userId" = $1', [owner.userId]);
      await manager.query(
        'UPDATE password_reset_tokens SET "usedAt" = clock_timestamp() WHERE id = $1',
        [link.id],
      );
      await this.revokeOutstanding(manager, owner.userId);
    });
  }

  private linkQuery(lock: string): string {
    return `SELECT id, "userId", "expiresAt" <= clock_timestamp() AS expired,
      ("usedAt" IS NOT NULL OR "revokedAt" IS NOT NULL) AS finished
      FROM password_reset_tokens WHERE "tokenHash" = $1 ${lock}`;
  }

  private state(link: LinkRow | undefined): ResetLinkState {
    if (!link || link.finished) return 'invalid';
    return link.expired ? 'expired' : 'valid';
  }

  private async revokeOutstanding(manager: EntityManager, userId: string): Promise<void> {
    await manager.query(
      `UPDATE password_reset_tokens SET "revokedAt" = clock_timestamp()
      WHERE "userId" = $1 AND "usedAt" IS NULL AND "revokedAt" IS NULL`,
      [userId],
    );
  }
}
