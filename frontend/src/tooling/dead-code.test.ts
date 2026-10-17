import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(file);
    return /\.(ts|tsx|css)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [readFileSync(file, 'utf8')]
      : [];
  });
}

describe('FRONTEND-NO-DEAD-CODE: nothing unused ships or is configured', () => {
  it('every runtime dependency is imported by the app', () => {
    const code = sources(path.join(root, 'src')).join('\n');
    const unused = Object.keys(pkg.dependencies).filter((name) => !code.includes(`'${name}`));
    expect(unused).toEqual([]);
  });

  it('no script needs the @vitest/ui package that is not installed', () => {
    const needsUi = Object.values<string>(pkg.scripts).filter((script) => script.includes('--ui'));
    expect(needsUi).toEqual([]);
  });

  it('the global axios instance is not configured; api/client.ts owns every request', () => {
    expect(existsSync(path.join(root, 'src/utils/axiosConfig.ts'))).toBe(false);
  });

  it('coverage measures components and claims no threshold it does not enforce', () => {
    const config = readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
    expect(config).toContain("'src/**/*.tsx'");
    expect(config).not.toContain('thresholds');
  });
});
