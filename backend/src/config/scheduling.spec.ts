import 'reflect-metadata';
import { DynamicModule } from '@nestjs/common';

// Read the actual AppModule scheduler registration without connecting to a DB.
// The jobs themselves and their PRICE_COLLECTION_ENABLED gate are pinned in
// ../observability/scheduled-tick.spec.ts.
describe('ISO-005-B periodic scheduling control', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it('registers the scheduler with its defaults, so every interval job is always registered', async () => {
    process.env.FRONTEND_URL = 'https://synthetic-scheduling.invalid';
    process.env.MFA_KEY_FILE = '/synthetic/key';
    process.env.MFA_KEY_ID = 'synthetic';
    process.env.TRUSTED_PROXY_IPS = '[]';
    await jest.isolateModulesAsync(async () => {
      const { AppModule } = await import('../app.module');
      const modules: DynamicModule[] = Reflect.getMetadata('imports', AppModule);
      const scheduler = modules.find((module) => module.module?.name === 'ScheduleModule');
      const options = scheduler?.providers?.find(
        (provider) =>
          typeof provider === 'object' &&
          'provide' in provider &&
          provider.provide === 'SCHEDULE_MODULE_OPTIONS',
      );
      expect(options).toMatchObject({
        useValue: { cronJobs: true, intervals: true, timeouts: true },
      });
    });
  });
});
