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

/** Whether the code imports the package itself or one of its subpaths, never a longer name. */
const isImported = (code: string, name: string) => {
  // Only import specifiers count: a comment or a string constant naming a package does not.
  const bare = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  const spec = `['"]${name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(/[^'"]*)?['"]`;
  return [
    `\\b(?:import|export)\\b[^;'"]*?\\bfrom\\s*${spec}`,
    `\\bimport\\s*${spec}`,
    `\\bimport\\s*\\(\\s*${spec}`,
    `@import\\s+(?:url\\(\\s*)?${spec}`,
  ].some((form) => new RegExp(form).test(bare));
};

describe('FRONTEND-NO-DEAD-CODE: nothing unused ships or is configured', () => {
  it('every runtime dependency is imported by the app', () => {
    const code = sources(path.join(root, 'src')).join('\n');
    const unused = Object.keys(pkg.dependencies).filter((name) => !isImported(code, name));
    expect(unused).toEqual([]);
  });

  it('counts a package only by its own name or subpath, not a longer name it prefixes', () => {
    const code =
      'import { createRoot } from \'react-dom/client\';\nimport x from "i18next-browser-languagedetector";';
    expect(isImported(code, 'react-dom')).toBe(true);
    expect(isImported(code, 'react')).toBe(false);
    expect(isImported(code, 'i18next')).toBe(false);
    expect(isImported(code, 'i18next-browser-languagedetector')).toBe(true);
  });

  it('counts only import specifiers, not a comment or a string constant naming a package', () => {
    expect(isImported("import axios from 'axios';", 'axios')).toBe(true);
    expect(isImported("import 'axios';", 'axios')).toBe(true);
    expect(isImported("export { a } from 'axios';", 'axios')).toBe(true);
    expect(isImported("const m = await import('axios');", 'axios')).toBe(true);
    expect(isImported("import {\n  a,\n} from 'axios';", 'axios')).toBe(true);
    expect(isImported("@import 'axios/x.css';", 'axios')).toBe(true);
    expect(isImported("// import axios from 'axios';\nconst packageName = 'axios';", 'axios')).toBe(
      false,
    );
    expect(isImported('/* import \'axios\' */ const n = "axios";', 'axios')).toBe(false);
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
