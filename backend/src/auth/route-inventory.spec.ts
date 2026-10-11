import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const sourceRoot = resolve(__dirname, '..');

function controllerFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return controllerFiles(path);
    return name.endsWith('.controller.ts') ? [path] : [];
  });
}

/**
 * Every route that skips the owner's session or accepts a pending one, as `file:handler`. The
 * session guard is the default for every controller (APP_GUARD), so a route that opts out is
 * listed here by name: a data controller that gained `@Public()` or `@AllowPending()` fails
 * until somebody reads the change and updates the list.
 */
function routesMarkedWith(decorator: 'Public' | 'AllowPending'): string[] {
  const found: string[] = [];
  for (const file of controllerFiles(sourceRoot)) {
    const source = readFileSync(file, 'utf8');
    for (const marker of source.matchAll(new RegExp(`@${decorator}\\(\\)`, 'g'))) {
      const rest = source.slice((marker.index ?? 0) + marker[0].length);
      // A class-level marker would open every route of the controller.
      expect(rest).not.toMatch(/^\s*(?:@Controller|export\s)/);
      const handler = rest.slice(0, 800).match(/\n\s*(?:async\s+)?(\w+)\s*\(/);
      expect(handler).not.toBeNull();
      found.push(`${relative(sourceRoot, file)}:${handler?.[1]}`);
    }
  }
  return found.sort();
}

describe('QA-ROUTES: the routes that opt out of the owner session are exactly the reviewed ones', () => {
  it('lists the public routes: the CSRF step, login, password reset and the basic liveness probe', () => {
    expect(routesMarkedWith('Public')).toEqual([
      'auth/auth.controller.ts:csrf',
      'auth/auth.controller.ts:login',
      'auth/password-reset.controller.ts:confirm',
      'auth/password-reset.controller.ts:request',
      'auth/password-reset.controller.ts:status',
      'health/health.controller.ts:liveness',
    ]);
  });

  it('lists the routes a session that has not finished MFA may call', () => {
    expect(routesMarkedWith('AllowPending')).toEqual([
      'auth/auth.controller.ts:logout',
      'auth/auth.controller.ts:mfa',
    ]);
  });

  it('finds every controller, so the scan cannot pass by looking at nothing', () => {
    const files = controllerFiles(sourceRoot).map((file) => relative(sourceRoot, file));
    expect(files).toEqual(
      expect.arrayContaining([
        'auth/auth.controller.ts',
        'accounting/trade.controller.ts',
        'health/health.controller.ts',
      ]),
    );
  });
});
