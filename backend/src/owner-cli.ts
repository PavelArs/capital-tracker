import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { OwnerInputError, parseOwnerCommand, readOwnerPassword } from './auth/owner-input';
import { hashPassword } from './auth/password';

async function main(): Promise<void> {
  const command = parseOwnerCommand(process.argv.slice(2));
  const password = await readOwnerPassword(command.passwordStdin);
  for (const setting of ['DB_HOST', 'DB_PORT', 'DB_USERNAME', 'DB_PASSWORD', 'DB_NAME']) {
    if (!process.env[setting])
      throw new OwnerInputError(`Missing required database setting: ${setting}`);
  }
  const port = Number(process.env.DB_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new OwnerInputError('Invalid database port configuration');
  const hash = await hashPassword(password);
  const { default: source } = await import('./typeorm-data-source');
  source.setOptions({ connectTimeoutMS: 5000 });
  await source.initialize();
  const runner = source.createQueryRunner();
  try {
    await runner.connect();
    await runner.startTransaction();
    const [lock] = await runner.query('SELECT pg_try_advisory_xact_lock(1763669182) AS acquired');
    if (lock.acquired !== true)
      throw new OwnerInputError('Another migration or owner command is running; retry later');
    const [owner] = await runner.query('SELECT * FROM owner_auth WHERE id = 1 FOR UPDATE');
    let userId = command.userId;
    if (command.action === 'bootstrap') {
      if (owner)
        throw new OwnerInputError(
          'Owner already provisioned; use recover with the established user ID',
        );
      const matches: { id: string }[] = await runner.query(
        'SELECT id FROM users WHERE lower(email) = $1',
        [command.email],
      );
      if (userId) {
        if (matches.length !== 1 || matches[0].id !== userId) {
          throw new OwnerInputError('Owner selection is unknown, mismatched or ambiguous');
        }
      } else {
        const [existing] = await runner.query('SELECT EXISTS(SELECT 1 FROM users) AS present');
        if (existing.present)
          throw new OwnerInputError('Existing users require explicit --existing-user-id selection');
        userId = randomUUID();
        await runner.query('INSERT INTO users(id, email, password) VALUES ($1, $2, $3)', [
          userId,
          command.email,
          hash,
        ]);
      }
      await runner.query(
        'INSERT INTO owner_auth(id, "userId", "credentialVersion") VALUES (1, $1, $2)',
        [userId, randomUUID()],
      );
    } else {
      if (!owner || owner.userId !== userId)
        throw new OwnerInputError('Recovery requires the established owner user ID');
      await runner.query('SELECT 1 FROM owner_mfa WHERE id = 1 FOR UPDATE');
      await runner.query(`UPDATE owner_mfa SET "candidateId" = NULL, "candidateEnvelope" = NULL,
        "candidateExpiresAt" = NULL, "candidateAttempts" = 0, "failedAttempts" = 0,
        "failureWindowStart" = NULL, "blockedUntil" = NULL WHERE id = 1`);
      await runner.query('UPDATE owner_auth SET "credentialVersion" = $1 WHERE id = 1', [
        randomUUID(),
      ]);
    }
    await runner.query(
      `UPDATE users SET password = $1, "emailVerified" = true,
      "emailVerificationToken" = NULL, "resetPasswordToken" = NULL,
      "resetPasswordExpires" = NULL, "updatedAt" = now() WHERE id = $2`,
      [hash, userId],
    );
    await runner.query('DELETE FROM auth_sessions WHERE "userId" = $1', [userId]);
    await runner.commitTransaction();
    console.log(
      command.action === 'bootstrap'
        ? 'Owner provisioned'
        : 'Owner password recovered; earlier credentials revoked',
    );
  } catch (error) {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    throw error;
  } finally {
    try {
      await runner.release();
    } finally {
      await source.destroy();
    }
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof OwnerInputError
      ? error.message
      : 'Owner command failed; verify configuration and migrated database. No credential details are logged.',
  );
  process.exitCode = 1;
});
