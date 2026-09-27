import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const validatorPath = resolve(__dirname, '../../../scripts/validate-manual-mvp-release.cjs');
const commit = 'a'.repeat(40);
const runId = '123456789';
const manifest = () => ({
  schemaVersion: 1,
  commit,
  runId,
  backend: { imageId: `sha256:${'b'.repeat(64)}`, tag: 'capital-tracker-backend:acceptance' },
  frontend: { imageId: `sha256:${'c'.repeat(64)}`, tag: 'capital-tracker-frontend:acceptance' },
});
let validateRelease: (value: unknown, expectedCommit: string, expectedRunId: string) => unknown;
let directory: string;
beforeAll(() => {
  // Missing new helper is scaffolding only; actual predecessor RED is recorded separately.
  expect(existsSync(validatorPath)).toBe(true);
  ({ validateRelease } = require(validatorPath));
  expect(typeof validateRelease).toBe('function');
});
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'capital-mvp-validator-'));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});
function invoke(value: unknown, expectedCommit = commit, expectedRunId = runId) {
  const path = join(directory, 'synthetic-manifest.json');
  writeFileSync(path, JSON.stringify(value));
  const result = spawnSync(process.execPath, [validatorPath, path, expectedCommit, expectedRunId], {
    encoding: 'utf8',
    timeout: 5000,
  });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  return result;
}

describe('MVP-002: exact tested candidate manifest', () => {
  it('accepts the exact image pair/commit/run and preserves the manifest', () => {
    const candidate = manifest();
    const original = JSON.stringify(candidate);
    expect(validateRelease(candidate, commit, runId)).toEqual(candidate);
    expect(JSON.stringify(candidate)).toBe(original);
    expect(invoke(candidate).status).toBe(0);
  });
  it.each(['commit', 'runId'] as const)(
    'rejects candidate %s from a different tested run',
    (field) => {
      const candidate = {
        ...manifest(),
        [field]: field === 'commit' ? 'd'.repeat(40) : '987654321',
      };
      expect(() => validateRelease(candidate, commit, runId)).toThrow();
      expect(invoke(candidate).status).not.toBe(0);
    },
  );
  it.each([
    null,
    [],
    {},
    'candidate',
    { ...manifest(), schemaVersion: 2 },
    { ...manifest(), schemaVersion: '1' },
    { ...manifest(), commit: 'A'.repeat(40) },
    { ...manifest(), commit: 'a'.repeat(39) },
    { ...manifest(), runId: 123456789 },
    { ...manifest(), runId: '0' },
    { ...manifest(), runId: '1;echo injected' },
  ])('rejects malformed manifest %p', (candidate) => {
    expect(() => validateRelease(candidate, commit, runId)).toThrow();
  });
  it.each(['credentials', '__proto__', 'constructor'])(
    'rejects additional top-level field %s',
    (field) => {
      const candidate = { ...manifest(), [field]: 'untrusted' };
      expect(() => validateRelease(candidate, commit, runId)).toThrow();
    },
  );
  it.each(['backend', 'frontend'] as const)(
    'requires a complete exact %s image identity',
    (part) => {
      for (const identity of [
        null,
        {},
        { imageId: `sha256:${'b'.repeat(64)}` },
        { ...manifest()[part], extra: true },
        { ...manifest()[part], imageId: 'latest' },
        { ...manifest()[part], imageId: `sha256:${'A'.repeat(64)}` },
        { ...manifest()[part], imageId: `sha256:${'b'.repeat(63)}` },
        { ...manifest()[part], tag: 'foreign:acceptance' },
        { ...manifest()[part], tag: manifest()[part === 'backend' ? 'frontend' : 'backend'].tag },
      ]) {
        expect(() => validateRelease({ ...manifest(), [part]: identity }, commit, runId)).toThrow();
      }
    },
  );
  it('fails CLI safely without echoing untrusted manifest contents', () => {
    const secret = 'SYNTHETIC_PRIVATE_VALUE_NEVER_ECHO';
    const result = invoke({ ...manifest(), credentials: secret });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).not.toContain(secret);
    const path = join(directory, 'malformed.json');
    writeFileSync(path, `{${secret}`);
    const malformed = spawnSync(process.execPath, [validatorPath, path, commit, runId], {
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(malformed.status).not.toBe(0);
    expect(malformed.stdout + malformed.stderr).not.toContain(secret);
    const missing = spawnSync(process.execPath, [validatorPath], {
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(missing.status).not.toBe(0);
  });
});
