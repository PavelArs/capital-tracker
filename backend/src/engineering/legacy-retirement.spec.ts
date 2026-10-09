import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DynamicModule, Type } from '@nestjs/common';

// M20: the screens of these modules are gone, so their APIs and background collectors go too.
// Their tables and rows stay; the JSON backup carries them (backup-tables.ts, legacyTables).
const retired = ['assets', 'liabilities', 'crypto', 'currencies', 'display-fx', 'metrics'];

describe('LEGACY-API: retired legacy modules are no longer part of the application', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it('AppModule registers none of them', async () => {
    process.env.FRONTEND_URL = 'https://synthetic-retirement.invalid';
    process.env.MFA_KEY_FILE = '/synthetic/key';
    process.env.MFA_KEY_ID = 'synthetic';
    process.env.TRUSTED_PROXY_IPS = '[]';
    await jest.isolateModulesAsync(async () => {
      const { AppModule } = await import('../app.module');
      const modules: (Type | DynamicModule)[] = Reflect.getMetadata('imports', AppModule);
      const names = modules.map((module) => ('module' in module ? module.module : module).name);
      expect(names).toContain('WalletAddressesModule');
      for (const name of [
        'AssetsModule',
        'LiabilitiesModule',
        'CryptoModule',
        'CurrenciesModule',
        'DisplayFxModule',
        'MetricsModule',
      ])
        expect(names).not.toContain(name);
    });
  });

  it.each(retired)('has no %s source folder', (folder) => {
    expect(existsSync(join(__dirname, '..', folder))).toBe(false);
  });
});
