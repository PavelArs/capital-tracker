import 'reflect-metadata';
import {
  constants,
  closeSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { ConfigService } from '@nestjs/config';
import { MfaInputError, parseMfaCommand, readMfaCode } from './auth/mfa-input';

export async function runWithPrivateOutput<T>(
  output: string,
  action: (publish: (payload: unknown) => void) => Promise<T>,
): Promise<T> {
  let fd: number | undefined = openSync(
    output,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  const identity = fstatSync(fd, { bigint: true });
  let published = false;
  const ownsOutput = () => {
    try {
      const current = lstatSync(output, { bigint: true });
      return current.isFile() && current.dev === identity.dev && current.ino === identity.ino;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  };
  const verifyOutput = () => {
    if (!ownsOutput() || (lstatSync(output, { bigint: true }).mode & 0o7777n) !== 0o600n) {
      throw new MfaInputError('The private output file changed during enrollment');
    }
  };

  try {
    if (!identity.isFile()) throw new MfaInputError('MFA output must be a regular private file');
    fchmodSync(fd, 0o600);
    const publish = (payload: unknown) => {
      if (published || fd === undefined) throw new MfaInputError('Output was already published');
      verifyOutput();
      const json = JSON.stringify(payload);
      if (json === undefined) throw new MfaInputError('Invalid enrollment output');
      writeFileSync(fd, `${json}\n`, { encoding: 'utf8' });
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      verifyOutput();
      // The service may begin COMMIT only after this synchronous callback returns.
      published = true;
    };
    const result = await action(publish);
    if (!published && result !== false) {
      throw new MfaInputError('Enrollment did not publish its private output');
    }
    return result;
  } catch (error) {
    if (published) {
      throw new MfaInputError(
        'Output was published but the database outcome is uncertain. The protected output was retained; inspect enrollment state before retrying.',
      );
    }
    throw error;
  } finally {
    try {
      if (fd !== undefined) closeSync(fd);
    } finally {
      // An incomplete callback cannot reach COMMIT; never unlink a replacement path.
      if (!published && ownsOutput()) unlinkSync(output);
    }
  }
}

async function main(): Promise<void> {
  const command = parseMfaCommand(process.argv.slice(2));
  const code = command.action === 'confirm' ? await readMfaCode(command.codeStdin) : undefined;
  for (const setting of [
    'DB_HOST',
    'DB_PORT',
    'DB_USERNAME',
    'DB_PASSWORD',
    'DB_NAME',
    'FRONTEND_URL',
    'MFA_KEY_FILE',
    'MFA_KEY_ID',
  ]) {
    if (!process.env[setting]) throw new MfaInputError(`Missing required MFA setting: ${setting}`);
  }
  const port = Number(process.env.DB_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new MfaInputError('Invalid database port configuration');
  }
  const { default: source } = await import('./typeorm-data-source');
  const { SessionService } = await import('./auth/session.service');
  const { MfaService } = await import('./auth/mfa.service');
  const config = new ConfigService(process.env);
  const sessions = new SessionService(source, config);
  const mfa = new MfaService(source, config, sessions);
  source.setOptions({ connectTimeoutMS: 5000 });
  await source.initialize();
  try {
    if (command.action === 'prepare') {
      await runWithPrivateOutput(command.output, (publish) =>
        mfa.prepareEnrollment(command.userId, command.replace, publish),
      );
      console.log('Enrollment prepared; provisioning details are in the private output file.');
    } else {
      const confirmed = await runWithPrivateOutput(command.output, (publish) =>
        mfa.confirmEnrollment(command.userId, command.candidateId, code!, publish),
      );
      if (!confirmed)
        throw new MfaInputError('Enrollment confirmation failed; check the candidate and code.');
      console.log('Enrollment confirmed; recovery codes are in the private output file.');
    }
  } finally {
    await source.destroy();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(
      error instanceof MfaInputError
        ? error.message
        : 'MFA command failed; verify configuration, private output path and migrated database. No credential details are logged.',
    );
    process.exitCode = 1;
  });
}
