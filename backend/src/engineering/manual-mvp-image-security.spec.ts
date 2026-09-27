import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const scannerPath =
  process.env.MVP_IMAGE_SECURITY_UNDER_TEST ??
  resolve(__dirname, '../../../scripts/check-release-image-security.cjs');
const imageId = `sha256:${'a'.repeat(64)}`;
const report = () => ({
  SchemaVersion: 2,
  Metadata: { ImageID: imageId },
  Results: [{ Target: 'synthetic-alpine', Class: 'os-pkgs' }],
});
let checkReport: (value: unknown, expectedImageId: string) => void;
let redactReport: (value: unknown) => unknown;
beforeAll(() => {
  expect(existsSync(scannerPath)).toBe(true);
  ({ checkReport, redactReport } = require(scannerPath));
});

describe('MVP-002: exact tested image security report', () => {
  it('accepts a complete empty-finding OS report for only the tested image', () => {
    const candidate = report();
    const before = JSON.stringify(candidate);
    expect(() => checkReport(candidate, imageId)).not.toThrow();
    expect(JSON.stringify(candidate)).toBe(before);
  });
  it.each(['LOW', 'MODERATE'])(
    'retains permitted %s vulnerability and secret findings',
    (Severity) => {
      const candidate = {
        ...report(),
        Results: [
          {
            Class: 'os-pkgs',
            Vulnerabilities: [{ VulnerabilityID: 'CVE-SYNTHETIC', Severity, FixedVersion: '' }],
            Secrets: [{ RuleID: 'synthetic-secret', Severity }],
          },
        ],
      };
      const before = JSON.stringify(candidate);
      expect(() => checkReport(candidate, imageId)).not.toThrow();
      expect(JSON.stringify(candidate)).toBe(before);
    },
  );
  it.each([
    ['Vulnerabilities', 'HIGH'],
    ['Vulnerabilities', 'CRITICAL'],
    ['Secrets', 'HIGH'],
    ['Secrets', 'CRITICAL'],
  ])('blocks %s with %s severity including non-OS results', (field, Severity) => {
    const candidate = {
      ...report(),
      Results: [
        ...report().Results,
        {
          Class: 'lang-pkgs',
          [field]: [{ VulnerabilityID: 'CVE-SYNTHETIC', RuleID: 'synthetic-secret', Severity }],
        },
      ],
    };
    expect(() => checkReport(candidate, imageId)).toThrow(/high\/critical/);
  });
  it.each([
    null,
    { ...report(), SchemaVersion: 1 },
    { ...report(), Metadata: {} },
    { ...report(), Metadata: { ImageID: `sha256:${'b'.repeat(64)}` } },
    { ...report(), Results: [] },
    { ...report(), Results: [{ Class: 'lang-pkgs' }] },
  ])('refuses mismatched or incomplete scan identity/OS evidence %p', (candidate) => {
    expect(() => checkReport(candidate, imageId)).toThrow(/identity or structure/);
  });
  it('redacts image configuration and secret excerpts while retaining actionable findings', () => {
    const vulnerability = {
      VulnerabilityID: 'CVE-SYNTHETIC',
      Severity: 'CRITICAL',
      PkgName: 'synthetic-package',
      InstalledVersion: '1',
      FixedVersion: '',
      Status: 'affected',
    };
    const candidate = {
      ...report(),
      Metadata: { ImageID: imageId, ImageConfig: { Env: ['SYNTHETIC_CONFIG_CANARY'] } },
      Results: [
        {
          Class: 'os-pkgs',
          Target: 'synthetic-alpine',
          Vulnerabilities: [vulnerability],
          Secrets: [
            {
              RuleID: 'synthetic-secret',
              Severity: 'HIGH',
              Category: 'synthetic',
              Title: 'Synthetic rule',
              StartLine: 4,
              EndLine: 5,
              Match: 'SYNTHETIC_MATCH_CANARY',
              Content: 'SYNTHETIC_CONTENT_CANARY',
              Code: { Lines: ['SYNTHETIC_CODE_CANARY'] },
            },
          ],
        },
      ],
    };
    const sanitized = redactReport(candidate);
    expect(sanitized).toEqual({
      SchemaVersion: 2,
      Metadata: { ImageID: imageId },
      Results: [
        {
          Class: 'os-pkgs',
          Target: 'synthetic-alpine',
          Vulnerabilities: [vulnerability],
          Secrets: [
            {
              RuleID: 'synthetic-secret',
              Severity: 'HIGH',
              Category: 'synthetic',
              Title: 'Synthetic rule',
              StartLine: 4,
              EndLine: 5,
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(sanitized)).not.toContain('CANARY');
    // Sanitization must not turn a blocking report into a passing report.
    expect(() => checkReport(sanitized, imageId)).toThrow(/high\/critical/);
  });
});
