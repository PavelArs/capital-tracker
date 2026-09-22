import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWithPrivateOutput } from './mfa-cli';

describe('MFA-001 exclusive durable private output', () => {
  let directory: string;
  let output: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'capital-mfa-output-'));
    output = join(directory, 'enrollment.json');
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('reserves a regular0600 file before service work and publishes complete JSON before returning', async () => {
    const payload = {
      uri: 'otpauth://totp/synthetic',
      candidateId: 'synthetic',
      expiresAt: '2026-09-22T00:00:00Z',
    };
    const result = await runWithPrivateOutput(output, async (publish) => {
      expect(statSync(output).isFile()).toBe(true);
      expect(statSync(output).mode & 0o777).toBe(0o600);
      expect(readFileSync(output)).toHaveLength(0);
      publish(payload);
      expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual(payload);
      return 'committed';
    });
    expect(result).toBe('committed');
    expect(statSync(output).mode & 0o777).toBe(0o600);
  });

  it('does not enter service work or overwrite an existing file', async () => {
    writeFileSync(output, 'owner bytes', { mode: 0o640 });
    const action = jest.fn();
    await expect(runWithPrivateOutput(output, action)).rejects.toThrow();
    expect(action).not.toHaveBeenCalled();
    expect(readFileSync(output, 'utf8')).toBe('owner bytes');
    expect(statSync(output).mode & 0o777).toBe(0o640);
  });

  it.each([false, true])('refuses a symlink without touching its %s target', async (exists) => {
    const target = join(directory, 'owner-file');
    if (exists) writeFileSync(target, 'owner bytes');
    symlinkSync(target, output);
    const action = jest.fn();
    await expect(runWithPrivateOutput(output, action)).rejects.toThrow();
    expect(action).not.toHaveBeenCalled();
    expect(lstatSync(output).isSymbolicLink()).toBe(true);
    if (exists) expect(readFileSync(target, 'utf8')).toBe('owner bytes');
    else expect(() => lstatSync(target)).toThrow();
  });

  it('removes its own unused file after invalid confirmation without publishing', async () => {
    expect(await runWithPrivateOutput(output, async () => false)).toBe(false);
    expect(() => lstatSync(output)).toThrow();
  });

  it('removes only its own empty file after a prepublication service rejection', async () => {
    const failure = new Error('synthetic service failure');
    await expect(
      runWithPrivateOutput(output, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(() => lstatSync(output)).toThrow();
  });

  it('removes its own file when serialization fails before publication can finish', async () => {
    await expect(
      runWithPrivateOutput(output, async (publish) => {
        publish({ value: 1n });
      }),
    ).rejects.toThrow();
    expect(() => lstatSync(output)).toThrow();
  });

  it('does not finish publication when fsync fails and cleans up its own incomplete output', async () => {
    const sync = jest.spyOn(fs, 'fsyncSync').mockImplementationOnce(() => {
      throw new Error('synthetic disk failure');
    });
    try {
      await expect(
        runWithPrivateOutput(output, async (publish) => {
          publish({ recoveryCodes: ['synthetic'] });
          throw new Error('This commit boundary must not be reached');
        }),
      ).rejects.toThrow('synthetic disk failure');
      expect(() => lstatSync(output)).toThrow();
    } finally {
      sync.mockRestore();
    }
  });

  it('retains completed recovery output when commit success is ambiguous and hides driver details', async () => {
    const payload = { recoveryCodes: ['synthetic-recovery'] };
    await expect(
      runWithPrivateOutput(output, async (publish) => {
        publish(payload);
        throw new Error('driver secret marker');
      }),
    ).rejects.toThrow('Output was published but the database outcome is uncertain');
    expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual(payload);
    expect(statSync(output).mode & 0o777).toBe(0o600);
  });

  it('never removes a replacement inode on failure', async () => {
    const owned = join(directory, 'owned-file');
    await expect(
      runWithPrivateOutput(output, async () => {
        renameSync(output, owned);
        writeFileSync(output, 'replacement bytes');
        throw new Error('ordinary failure');
      }),
    ).rejects.toThrow('ordinary failure');
    expect(readFileSync(output, 'utf8')).toBe('replacement bytes');
    expect(readFileSync(owned)).toHaveLength(0);
  });

  it('does not follow or remove a symlink substituted before publication', async () => {
    const target = join(directory, 'owner-file');
    writeFileSync(target, 'owner bytes');
    await expect(
      runWithPrivateOutput(output, async (publish) => {
        unlinkSync(output);
        symlinkSync(target, output);
        publish({ recoveryCodes: ['synthetic'] });
      }),
    ).rejects.toThrow();
    expect(lstatSync(output).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe('owner bytes');
  });
});
