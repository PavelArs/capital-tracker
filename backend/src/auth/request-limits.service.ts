import { createHash } from 'node:crypto';
import { HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

const policies = {
  'csrf-ip': { limit: 30, seconds: 60 },
  'login-ip': { limit: 5, seconds: 60 },
  'mfa-ip': { limit: 5, seconds: 60 },
  'login-account': { limit: 10, seconds: 600 },
  'reset-ip': { limit: 5, seconds: 60 },
} as const;
export type AuthRequestScope = keyof typeof policies;

export class AuthRequestLimitException extends HttpException {
  constructor(readonly retryAfter: number) {
    super('Too many requests', 429);
  }
}

// null means admitted; a positive integer is a committed, fixed-window refusal.
type Admission = number | null;

@Injectable()
export class AuthRequestLimitsService {
  constructor(private readonly source: DataSource) {}

  async admit(scope: AuthRequestScope, subject: string): Promise<void> {
    let admission: Admission;
    try {
      // Callers supply the canonical source or validated normalized email. Reject
      // internal misuse without opening a transaction or exposing its inputs.
      if (
        !Object.hasOwn(policies, scope) ||
        typeof subject !== 'string' ||
        subject.length === 0 ||
        subject.length > 254
      ) {
        throw new Error('Invalid admission subject');
      }
      const digest = createHash('sha256')
        .update(JSON.stringify(['ct-auth-request-v1', scope, subject]))
        .digest('hex');
      admission = await this.source.transaction((manager) => this.reserve(manager, scope, digest));
    } catch {
      // Includes pool checkout and ambiguous commit failures. Never retry or fall
      // back to process memory: a commit may already have spent an admission.
      throw new ServiceUnavailableException('Authentication service unavailable');
    }
    // Throw only after commit, preserving legitimate pruning on a denied request.
    if (admission !== null) throw new AuthRequestLimitException(admission);
  }

  private async reserve(
    manager: EntityManager,
    scope: AuthRequestScope,
    digest: string,
  ): Promise<Admission> {
    const policy = policies[scope];
    await manager.query("SET LOCAL lock_timeout = '2s'");
    await manager.query("SET LOCAL statement_timeout = '5s'");
    await manager.query('SELECT pg_advisory_xact_lock(1763669184)');
    await manager.query('DELETE FROM auth_request_limits WHERE "expiresAt" <= clock_timestamp()');
    // Acquire the row before reading decision time: an external maintenance/test
    // transaction may hold it even while this service owns the advisory lock.
    await manager.query(
      'SELECT 1 FROM auth_request_limits WHERE scope = $1 AND "subjectHash" = $2 FOR UPDATE',
      [scope, digest],
    );
    const [existing]: { hits: number; expired: boolean; retryAfter: number }[] =
      await manager.query(
        `WITH moment AS MATERIALIZED (SELECT clock_timestamp() AS now)
        SELECT hits, "expiresAt" <= moment.now AS expired,
          LEAST($3::int, GREATEST(1, ceil(EXTRACT(EPOCH FROM
            ("expiresAt" - moment.now)))::int)) AS "retryAfter"
        FROM auth_request_limits CROSS JOIN moment WHERE scope = $1 AND "subjectHash" = $2`,
        [scope, digest, policy.seconds],
      );
    if (existing && !existing.expired) {
      if (existing.hits >= policy.limit) return existing.retryAfter;
      await manager.query(
        'UPDATE auth_request_limits SET hits = hits + 1 WHERE scope = $1 AND "subjectHash" = $2',
        [scope, digest],
      );
      return null;
    }
    if (existing) {
      await manager.query(
        'DELETE FROM auth_request_limits WHERE scope = $1 AND "subjectHash" = $2',
        [scope, digest],
      );
    }

    // Pruning itself can wait across expiry. Count LIVE rows at a new decision
    // instant, rather than counting every surviving row or reusing a pre-wait clock.
    const [capacity]: { count: number; retryAfter: number | null }[] = await manager.query(
      `WITH moment AS MATERIALIZED (SELECT clock_timestamp() AS now)
      SELECT count(*)::int AS count,
        LEAST(600, GREATEST(1, ceil(EXTRACT(EPOCH FROM
          (min("expiresAt") - moment.now)))::int)) AS "retryAfter"
      FROM auth_request_limits CROSS JOIN moment
      WHERE "expiresAt" > moment.now GROUP BY moment.now`,
    );
    if (capacity && capacity.count >= 4096) return capacity.retryAfter!;
    await manager.query(
      `WITH moment AS MATERIALIZED (SELECT clock_timestamp() AS now)
      INSERT INTO auth_request_limits (scope, "subjectHash", hits, "windowStartedAt", "expiresAt")
      SELECT $1, $2, 1, moment.now, moment.now + $3 * interval '1 second' FROM moment`,
      [scope, digest, policy.seconds],
    );
    return null;
  }
}
