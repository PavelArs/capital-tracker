import 'reflect-metadata';
import { DynamicModule } from '@nestjs/common';

// Read the actual AppModule scheduler registration without connecting to a DB.
describe('ISO-005-B periodic scheduling control', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it.each([
    [undefined, true],
    ['false', false],
    ['true', true],
  ])('configures cron registration for setting %s as %s', async (setting, expected) => {
    process.env.FRONTEND_URL = 'https://synthetic-scheduling.invalid';
    process.env.MFA_KEY_FILE = '/synthetic/key';
    process.env.MFA_KEY_ID = 'synthetic';
    process.env.TRUSTED_PROXY_IPS = '[]';
    if (setting === undefined) Reflect.deleteProperty(process.env, 'BACKGROUND_JOBS_ENABLED');
    else process.env.BACKGROUND_JOBS_ENABLED = setting;
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
      expect(options).toMatchObject({ useValue: { cronJobs: expected } });
    });
  });
});
