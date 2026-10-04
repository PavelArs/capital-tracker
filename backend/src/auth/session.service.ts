import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  ForbiddenException,
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { UserWithoutPassword, ValidatedOwner } from './auth.service';

export const SESSION_COOKIE = '__Host-ct-session';
export const COOKIE_OPTIONS = {
  secure: true,
  httpOnly: true,
  sameSite: 'strict' as const,
  path: '/',
};
const ANONYMOUS_MS = 5 * 60 * 1000;
// A full session lasts one day from factor completion; there is no idle timeout.
export const FULL_SESSION_MS = 24 * 60 * 60 * 1000;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
export const sessionHash = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export function readSessionCookie(header: string | undefined): string | null {
  if (!header) return null;
  const values = header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${SESSION_COOKIE}=`))
    .map((part) => part.slice(SESSION_COOKIE.length + 1));
  return values.length === 1 && tokenPattern.test(values[0]) ? values[0] : null;
}

export interface SessionIdentity {
  hash: string;
  csrfToken: string;
  state: 'anonymous' | 'pending_mfa' | 'authenticated';
  user?: { userId: string; email: string };
}
export interface SessionRow {
  tokenHash: string;
  csrfToken: string;
  state: 'anonymous' | 'pending_mfa' | 'authenticated';
  userId: string | null;
  credentialVersion: string | null;
  boundUserId: string | null;
  boundVersion: string | null;
  ownerEmail: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  databaseNow: Date;
  failedAttempts: number;
  mfaVerifiedAt: Date | null;
}

@Injectable()
export class SessionService {
  readonly origin: string;

  constructor(
    private readonly source: DataSource,
    config: ConfigService,
  ) {
    const configured = config.get<string>('FRONTEND_URL');
    try {
      if (
        !configured ||
        new URL(configured).protocol !== 'https:' ||
        new URL(configured).origin !== configured
      )
        throw new Error();
    } catch {
      throw new Error('FRONTEND_URL must be an exact HTTPS origin without path or credentials');
    }
    this.origin = configured;
  }

  checkOrigin(origin: unknown): void {
    if (typeof origin !== 'string' || origin !== this.origin) throw new ForbiddenException();
  }

  async row(manager: EntityManager, hash: string): Promise<SessionRow | undefined> {
    const [row] = await manager.query(
      `SELECT s.*, o."userId" AS "boundUserId",
      o."credentialVersion" AS "boundVersion", u.email AS "ownerEmail"
      FROM auth_sessions s LEFT JOIN owner_auth o ON o.id = 1
      LEFT JOIN users u ON u.id = o."userId"
      WHERE s."tokenHash" = $1 FOR UPDATE OF s`,
      [hash],
    );
    if (row) {
      // A row lock may wait until after expiry. Read the clock after acquiring it.
      const [clock] = await manager.query('SELECT clock_timestamp() AS "databaseNow"');
      row.databaseNow = clock.databaseNow;
    }
    return row;
  }

  valid(row: SessionRow | undefined): row is SessionRow {
    if (!row || row.expiresAt.getTime() <= row.databaseNow.getTime()) return false;
    if (row.state === 'anonymous') return true;
    return (
      (row.state === 'pending_mfa' || (row.state === 'authenticated' && !!row.mfaVerifiedAt)) &&
      row.userId === row.boundUserId &&
      row.credentialVersion === row.boundVersion &&
      !!row.ownerEmail
    );
  }

  private identity(row: SessionRow): SessionIdentity {
    return {
      hash: row.tokenHash,
      csrfToken: row.csrfToken,
      state: row.state,
      ...(row.state === 'authenticated'
        ? { user: { userId: row.userId!, email: row.ownerEmail! } }
        : {}),
    };
  }

  async creationLock(manager: EntityManager): Promise<void> {
    await manager.query("SET LOCAL lock_timeout = '5s'");
    await manager.query('SELECT pg_advisory_xact_lock(1763669183)');
    await manager.query(`DELETE FROM auth_sessions s WHERE "expiresAt" <= clock_timestamp()
      OR (state <> 'anonymous' AND (
        NOT EXISTS (SELECT 1 FROM owner_auth o WHERE o.id = 1 AND o."userId" = s."userId"
          AND o."credentialVersion" = s."credentialVersion")))`);
  }

  private async insert(manager: EntityManager, owner?: ValidatedOwner, full = false) {
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    const lifetime = full ? FULL_SESSION_MS : ANONYMOUS_MS;
    await manager.query(
      `INSERT INTO auth_sessions ("tokenHash", "csrfToken", state, "userId",
      "credentialVersion", "createdAt", "lastSeenAt", "expiresAt", "mfaVerifiedAt")
      VALUES ($1, $2, $3, $4, $5, statement_timestamp(), statement_timestamp(),
        statement_timestamp() + $6 * interval '1 millisecond',
        CASE WHEN $7 THEN statement_timestamp() ELSE NULL END)`,
      [
        sessionHash(token),
        csrfToken,
        owner ? (full ? 'authenticated' : 'pending_mfa') : 'anonymous',
        owner?.user.id ?? null,
        owner?.credentialVersion ?? null,
        lifetime,
        full,
      ],
    );
    return { token, csrfToken };
  }

  async csrf(token: string | null): Promise<{ token?: string; csrfToken: string }> {
    return this.source.transaction(async (manager) => {
      // Serialize creation; never evict a valid anonymous session.
      await this.creationLock(manager);
      if (token && tokenPattern.test(token)) {
        const existing = await this.row(manager, sessionHash(token));
        if (this.valid(existing)) return { csrfToken: existing.csrfToken };
      }
      const [{ count }] = await manager.query(
        "SELECT count(*)::int AS count FROM auth_sessions WHERE state <> 'authenticated'",
      );
      if (count >= 512) throw new HttpException('Too many sessions', 429);
      return this.insert(manager);
    });
  }

  async authorize(
    token: string | null,
    requireOwner: boolean,
    method: string,
    origin: unknown,
    csrf: unknown,
    allowPending = false,
    readOnly = false,
  ): Promise<SessionIdentity> {
    const denied = () => (requireOwner ? new UnauthorizedException() : new ForbiddenException());
    if (!token || !tokenPattern.test(token)) throw denied();
    return this.source.transaction(async (manager) => {
      const row = await this.row(manager, sessionHash(token));
      if (
        !this.valid(row) ||
        (requireOwner &&
          row.state !== 'authenticated' &&
          !(allowPending && row.state === 'pending_mfa'))
      )
        throw denied();
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) {
        this.checkOrigin(origin);
        if (
          typeof csrf !== 'string' ||
          !tokenPattern.test(csrf) ||
          !timingSafeEqual(Buffer.from(csrf), Buffer.from(row.csrfToken))
        )
          throw new ForbiddenException();
      }
      // The row lock serializes touches with logout/recovery; denied writes do not touch.
      if (!readOnly)
        await manager.query(
          'UPDATE auth_sessions SET "lastSeenAt" = clock_timestamp() WHERE "tokenHash" = $1',
          [row.tokenHash],
        );
      return this.identity(row);
    });
  }

  async rotate(
    hash: string,
    verified: ValidatedOwner,
  ): Promise<{ token: string; csrfToken: string }> {
    return this.source.transaction(async (manager) => {
      const [owner] = await manager.query('SELECT * FROM owner_auth WHERE id = 1 FOR SHARE');
      if (
        !owner ||
        owner.userId !== verified.user.id ||
        owner.credentialVersion !== verified.credentialVersion
      )
        throw new UnauthorizedException();
      const [factor] = await manager.query(
        'SELECT "activeVersion" FROM owner_mfa WHERE id = 1 AND "userId" = $1 FOR SHARE',
        [owner.userId],
      );
      if (!factor?.activeVersion) throw new UnauthorizedException();
      // Recovery locks the owner before deleting sessions. Preserve that lock order.
      await this.creationLock(manager);
      const previous = await this.row(manager, hash);
      if (!this.valid(previous)) throw new ForbiddenException();
      await manager.query('DELETE FROM auth_sessions WHERE "tokenHash" = $1', [hash]);
      const [{ count }] = await manager.query(
        "SELECT count(*)::int AS count FROM auth_sessions WHERE state <> 'authenticated'",
      );
      if (count >= 512) throw new HttpException('Too many sessions', 429);
      return this.insert(manager, verified);
    });
  }

  // Caller holds owner, factor, capacity and pending row locks in that order.
  async issueAuthenticated(
    manager: EntityManager,
    previous: SessionRow,
    verified: ValidatedOwner,
  ): Promise<{ token: string; csrfToken: string; user: UserWithoutPassword }> {
    await manager.query('DELETE FROM auth_sessions WHERE "tokenHash" = $1', [previous.tokenHash]);
    await manager.query(`DELETE FROM auth_sessions WHERE "tokenHash" IN (
      SELECT "tokenHash" FROM auth_sessions WHERE state = 'authenticated'
      ORDER BY "createdAt" DESC, "tokenHash" DESC OFFSET 9)`);
    const [{ now }] = await manager.query('SELECT clock_timestamp() AS now');
    if (previous.expiresAt.getTime() <= now.getTime()) throw new UnauthorizedException();
    return { ...(await this.insert(manager, verified, true)), user: verified.user };
  }

  async revoke(hash: string): Promise<void> {
    await this.source.query('DELETE FROM auth_sessions WHERE "tokenHash" = $1', [hash]);
  }
}
