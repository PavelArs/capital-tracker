import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const validatorPath =
  process.env.MVP_RELEASE_VALIDATOR_UNDER_TEST ??
  resolve(__dirname, '../../../scripts/validate-manual-mvp-release.cjs');
const commit = 'a'.repeat(40);
const runId = '123456789';
const manifest = () => ({
  schemaVersion: 2,
  commit,
  runId,
  backend: { imageId: `sha256:${'b'.repeat(64)}`, tag: 'capital-tracker-backend:acceptance' },
  frontend: { imageId: `sha256:${'c'.repeat(64)}`, tag: 'capital-tracker-frontend:acceptance' },
  infrastructure: {
    postgres: {
      imageId: `sha256:${'d'.repeat(64)}`,
      tag: 'postgres:18.6-alpine3.24',
      registryDigest: `postgres@sha256:${'d'.repeat(64)}`,
    },
    redis: {
      imageId: `sha256:${'e'.repeat(64)}`,
      tag: 'redis:8.10.2-alpine3.23',
      registryDigest: `redis@sha256:${'e'.repeat(64)}`,
    },
  },
});
const pins = () => ({
  postgres: {
    tag: 'postgres:18.6-alpine3.24',
    registryDigest: `postgres@sha256:${'d'.repeat(64)}`,
  },
  redis: { tag: 'redis:8.10.2-alpine3.23', registryDigest: `redis@sha256:${'e'.repeat(64)}` },
});
let validateRelease: (
  value: unknown,
  expectedCommit: string,
  expectedRunId: string,
  infrastructurePins: unknown,
) => unknown;
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
  if (directory) rmSync(directory, { recursive: true, force: true });
});
function invoke(value: unknown, expectedCommit = commit, expectedRunId = runId) {
  const path = join(directory, 'synthetic-manifest.json');
  writeFileSync(path, JSON.stringify(value));
  const pinPath = join(directory, 'synthetic-pins.json');
  writeFileSync(pinPath, JSON.stringify(pins()));
  const result = spawnSync(
    process.execPath,
    [validatorPath, path, expectedCommit, expectedRunId, pinPath],
    {
      encoding: 'utf8',
      timeout: 5000,
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  return result;
}

describe('MVP-002: exact tested candidate manifest', () => {
  it('accepts the exact image pair/commit/run and preserves the manifest', () => {
    const candidate = manifest();
    const original = JSON.stringify(candidate);
    expect(validateRelease(candidate, commit, runId, pins())).toEqual(candidate);
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
      expect(() => validateRelease(candidate, commit, runId, pins())).toThrow();
      expect(invoke(candidate).status).not.toBe(0);
    },
  );
  it.each([
    null,
    [],
    {},
    'candidate',
    { ...manifest(), schemaVersion: 1 },
    { ...manifest(), schemaVersion: '2' },
    { ...manifest(), commit: 'A'.repeat(40) },
    { ...manifest(), commit: 'a'.repeat(39) },
    { ...manifest(), runId: 123456789 },
    { ...manifest(), runId: '0' },
    { ...manifest(), runId: '1;echo injected' },
  ])('rejects malformed manifest %p', (candidate) => {
    expect(() => validateRelease(candidate, commit, runId, pins())).toThrow();
  });
  it.each(['credentials', '__proto__', 'constructor'])(
    'rejects additional top-level field %s',
    (field) => {
      const candidate = { ...manifest(), [field]: 'untrusted' };
      expect(() => validateRelease(candidate, commit, runId, pins())).toThrow();
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
        expect(() =>
          validateRelease({ ...manifest(), [part]: identity }, commit, runId, pins()),
        ).toThrow();
      }
    },
  );
  it('refuses old or incomplete manifests without the tested infrastructure pair', () => {
    const { infrastructure: _removed, ...oldCandidate } = manifest();
    expect(() =>
      validateRelease({ ...oldCandidate, schemaVersion: 1 }, commit, runId, pins()),
    ).toThrow();
    for (const infrastructure of [
      undefined,
      null,
      {},
      [],
      { postgres: manifest().infrastructure.postgres },
      { ...manifest().infrastructure, additional: true },
    ]) {
      expect(() =>
        validateRelease({ ...manifest(), infrastructure }, commit, runId, pins()),
      ).toThrow();
    }
  });
  it.each(['postgres', 'redis'] as const)(
    'requires the exact tested %s infrastructure identity',
    (name) => {
      const original = manifest().infrastructure[name];
      for (const identity of [
        null,
        {},
        { ...original, extra: true },
        { ...original, tag: `${name}:latest` },
        { ...original, imageId: `sha256:${'A'.repeat(64)}` },
        { ...original, imageId: `sha256:${'a'.repeat(63)}` },
        { ...original, registryDigest: `${name}@sha256:${'A'.repeat(64)}` },
        { ...original, registryDigest: `foreign@sha256:${'a'.repeat(64)}` },
        { ...original, registryDigest: original.registryDigest.slice(0, -1) },
      ]) {
        expect(() =>
          validateRelease(
            { ...manifest(), infrastructure: { ...manifest().infrastructure, [name]: identity } },
            commit,
            runId,
            pins(),
          ),
        ).toThrow();
      }
    },
  );
  it('requires a complete reviewed infrastructure pin set, not only self-asserted manifest digests', () => {
    for (const infrastructurePins of [
      undefined,
      null,
      {},
      { postgres: pins().postgres },
      { ...pins(), extra: true },
      { ...pins(), postgres: { ...pins().postgres, extra: true } },
      {
        ...pins(),
        postgres: { ...pins().postgres, registryDigest: `postgres@sha256:${'f'.repeat(64)}` },
      },
      { ...pins(), redis: { ...pins().redis, tag: 'redis:latest' } },
    ]) {
      expect(() => validateRelease(manifest(), commit, runId, infrastructurePins)).toThrow();
    }
  });
  it('refuses a manifest whose infrastructure digest differs from the separate CLI pin file', () => {
    const path = join(directory, 'synthetic-manifest.json');
    const pinPath = join(directory, 'synthetic-pins.json');
    writeFileSync(path, JSON.stringify(manifest()));
    writeFileSync(
      pinPath,
      JSON.stringify({
        ...pins(),
        redis: { ...pins().redis, registryDigest: `redis@sha256:${'f'.repeat(64)}` },
      }),
    );
    const result = spawnSync(process.execPath, [validatorPath, path, commit, runId, pinPath], {
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).not.toBe(0);
  });
  it('fails CLI safely without echoing untrusted manifest contents', () => {
    const secret = 'SYNTHETIC_PRIVATE_VALUE_NEVER_ECHO';
    const result = invoke({ ...manifest(), credentials: secret });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).not.toContain(secret);
    const path = join(directory, 'malformed.json');
    writeFileSync(path, `{${secret}`);
    const malformed = spawnSync(
      process.execPath,
      [validatorPath, path, commit, runId, join(directory, 'synthetic-pins.json')],
      {
        encoding: 'utf8',
        timeout: 5000,
      },
    );
    expect(malformed.status).not.toBe(0);
    expect(malformed.stdout + malformed.stderr).not.toContain(secret);
    const missing = spawnSync(process.execPath, [validatorPath], {
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(missing.status).not.toBe(0);
  });
});
