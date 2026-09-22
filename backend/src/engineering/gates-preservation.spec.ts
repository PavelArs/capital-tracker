import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

type PreserveFile = <T>(path: string, action: () => T | Promise<T>) => Promise<T>;

const helperPath = resolve(__dirname, '../../../scripts/preserve-file.cjs');
let withPreservedFile: PreserveFile;
let directory: string;
let path: string;
const original = Buffer.from('server {\n  listen 80;\n  # Synthetic checkout configuration\n}\n');
const changed = Buffer.from('server {\n  listen 81;\n  # Synthetic checkout configuration\n}\n');

function createFile(contents: Buffer = original): void {
  writeFileSync(path, contents);
  chmodSync(path, 0o640);
}

function expectOriginal(): void {
  expect(lstatSync(path).isFile()).toBe(true);
  expect(readFileSync(path)).toEqual(original);
  expect(lstatSync(path).mode & 0o7777).toBe(0o640);
}

beforeAll(() => {
  // Helper absence is an implementation prerequisite, never the behavioral RED.
  // The real old artifact/check-out mismatch is demonstrated independently with Docker.
  if (!existsSync(helperPath))
    throw new Error('Missing implementation prerequisite: preserve-file.cjs');
  ({ withPreservedFile } = require(helperPath) as { withPreservedFile: PreserveFile });
  expect(typeof withPreservedFile).toBe('function');
});

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'capital-preservation-'));
  path = join(directory, 'nginx.conf');
  createFile();
});

afterEach(() => {
  // Only this test's newly created temporary directory is removed.
  if (directory) rmSync(directory, { recursive: true, force: true });
});

describe('ISO-005-C: portable configuration preservation', () => {
  it.each([
    ['clean checkout', Buffer.from('server { listen 80; }\n')],
    [
      'existing local edit',
      Buffer.from('server {\n  listen 443 ssl;\n  # Локальная настройка\n}\n'),
    ],
  ])(
    'accepts unchanged %s contents and returns the actual action value',
    async (_name, contents) => {
      createFile(contents as Buffer);
      const value = { checked: 'synthetic acceptance result' };
      const action = jest.fn(async () => {
        await Promise.resolve();
        return value;
      });

      await expect(withPreservedFile(path, action)).resolves.toBe(value);

      expect(action).toHaveBeenCalledTimes(1);
      expect(readFileSync(path)).toEqual(contents);
      expect(lstatSync(path).isFile()).toBe(true);
      expect(lstatSync(path).mode & 0o7777).toBe(0o640);
    },
  );

  it('rejects a same-length byte change without restoring the original bytes', async () => {
    expect(changed.length).toBe(original.length);
    await expect(
      withPreservedFile(path, async () => {
        await Promise.resolve();
        writeFileSync(path, changed);
      }),
    ).rejects.toBeInstanceOf(Error);

    expect(readFileSync(path)).toEqual(changed);
    expect(lstatSync(path).isFile()).toBe(true);
    expect(lstatSync(path).mode & 0o7777).toBe(0o640);
  });

  it('rejects truncation without filling or restoring the file', async () => {
    await expect(
      withPreservedFile(path, async () => {
        await Promise.resolve();
        writeFileSync(path, Buffer.alloc(0));
      }),
    ).rejects.toBeInstanceOf(Error);

    expect(lstatSync(path).isFile()).toBe(true);
    expect(readFileSync(path)).toEqual(Buffer.alloc(0));
  });

  it('rejects deletion without recreating the file', async () => {
    await expect(
      withPreservedFile(path, async () => {
        await Promise.resolve();
        unlinkSync(path);
      }),
    ).rejects.toMatchObject({ code: 'ENOENT' });

    expect(existsSync(path)).toBe(false);
  });

  it('rejects a same-content symlink replacement and leaves the link and target untouched', async () => {
    const target = join(directory, 'independent-target.conf');
    writeFileSync(target, original);
    chmodSync(target, 0o640);

    await expect(
      withPreservedFile(path, async () => {
        await Promise.resolve();
        unlinkSync(path);
        symlinkSync(target, path);
      }),
    ).rejects.toBeInstanceOf(Error);

    expect(lstatSync(path).isSymbolicLink()).toBe(true);
    expect(readlinkSync(path)).toBe(target);
    expect(readFileSync(target)).toEqual(original);
    expect(lstatSync(target).mode & 0o7777).toBe(0o640);
  });

  it('rejects a permission change without restoring permissions', async () => {
    await expect(
      withPreservedFile(path, async () => {
        await Promise.resolve();
        chmodSync(path, 0o600);
      }),
    ).rejects.toBeInstanceOf(Error);

    expect(readFileSync(path)).toEqual(original);
    expect(lstatSync(path).mode & 0o7777).toBe(0o600);
  });
});

describe('ISO-005-D: failure-path preservation', () => {
  it.each([undefined, 0, false, null, ''])(
    'retains a falsy thrown action value %p as a rejection',
    async (failure) => {
      await expect(
        withPreservedFile(path, async () => {
          throw failure;
        }),
      ).rejects.toBe(failure);

      expectOriginal();
    },
  );

  it('retains the exact action error when the file is preserved', async () => {
    const failure = new Error('Synthetic acceptance failure');
    await expect(
      withPreservedFile(path, async () => {
        await Promise.resolve();
        throw failure;
      }),
    ).rejects.toBe(failure);

    expectOriginal();
  });

  it('retains a synchronous action error when the file is preserved', async () => {
    const failure = new Error('Synthetic synchronous failure');
    await expect(
      withPreservedFile(path, () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    expectOriginal();
  });

  it('checks after failing cleanup and retains both errors without repairing the file', async () => {
    const failure = new Error('Synthetic acceptance or cleanup failure');
    const result = await withPreservedFile(path, async () => {
      try {
        await Promise.resolve();
        throw failure;
      } finally {
        writeFileSync(path, changed);
      }
    }).then(
      () => undefined,
      (error) => error as unknown,
    );

    expect(result).toBeInstanceOf(AggregateError);
    const errors = (result as AggregateError).errors as unknown[];
    expect(errors).toHaveLength(2);
    expect(errors).toContain(failure);
    const preservationFailure = errors.find((error) => error !== failure);
    expect(preservationFailure).toBeInstanceOf(Error);
    expect(readFileSync(path)).toEqual(changed);
    expect(lstatSync(path).mode & 0o7777).toBe(0o640);
  });

  it('fails on a missing baseline before the action runs', async () => {
    unlinkSync(path);
    const action = jest.fn(async () => 'must not run');

    await expect(withPreservedFile(path, action)).rejects.toMatchObject({ code: 'ENOENT' });

    expect(action).not.toHaveBeenCalled();
    expect(existsSync(path)).toBe(false);
  });

  it('fails on a symlink baseline before the action runs, leaving the target untouched', async () => {
    const target = join(directory, 'independent-baseline.conf');
    writeFileSync(target, original);
    unlinkSync(path);
    symlinkSync(target, path);
    const action = jest.fn(async () => 'must not run');

    await expect(withPreservedFile(path, action)).rejects.toBeInstanceOf(Error);

    expect(action).not.toHaveBeenCalled();
    expect(lstatSync(path).isSymbolicLink()).toBe(true);
    expect(readlinkSync(path)).toBe(target);
    expect(readFileSync(target)).toEqual(original);
  });

  it('fails on a directory baseline before the action runs', async () => {
    unlinkSync(path);
    mkdirSync(path);
    const action = jest.fn(async () => 'must not run');

    await expect(withPreservedFile(path, action)).rejects.toBeInstanceOf(Error);

    expect(action).not.toHaveBeenCalled();
    expect(lstatSync(path).isDirectory()).toBe(true);
  });
});
