import 'reflect-metadata';

describe('MIG-002: migration diagnostics do not disclose database values', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
    jest.restoreAllMocks();
  });

  it('suppresses raw migration failure messages from the configured TypeORM logger', async () => {
    Object.assign(process.env, {
      DB_HOST: 'synthetic-postgres.invalid',
      DB_PORT: '5432',
      DB_USERNAME: 'synthetic-owner',
      DB_PASSWORD: 'synthetic-password',
      DB_NAME: 'synthetic-database',
    });
    const marker = 'SYNTHETIC_PRIVATE_DATABASE_ERROR_MARKER';
    const outputs = [
      jest.spyOn(console, 'log').mockImplementation(() => undefined),
      jest.spyOn(console, 'warn').mockImplementation(() => undefined),
      jest.spyOn(console, 'error').mockImplementation(() => undefined),
      jest.spyOn(console, 'info').mockImplementation(() => undefined),
      jest.spyOn(console, 'debug').mockImplementation(() => undefined),
    ];

    // Construct the actual configured datasource/logger without connecting anywhere.
    const { default: dataSource } = await import('../typeorm-data-source');
    expect(dataSource.isInitialized).toBe(false);
    dataSource.logger.logMigration(`Migration failed: ${marker}`);

    expect(JSON.stringify(outputs.flatMap((spy) => spy.mock.calls))).not.toContain(marker);
  });
});
