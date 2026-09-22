import { ConfigService } from '@nestjs/config';
import { DataSource, DataSourceOptions } from 'typeorm';
import { TypeOrmConfigService } from './typeorm.config';

describe('MIG-001: application startup schema safety', () => {
  it('MIG-001-A never requests synchronization, migrations or extension installation', () => {
    const service = new TypeOrmConfigService(
      new ConfigService({
        DB_HOST: 'synthetic-postgres.invalid',
        DB_PORT: 5432,
        DB_USERNAME: 'synthetic-owner',
        DB_PASSWORD: 'synthetic-password',
        DB_NAME: 'synthetic-database',
      }),
    );

    expect(service.createTypeOrmOptions()).toMatchObject({
      synchronize: false,
      migrationsRun: false,
      installExtensions: false,
    });
  });
});

describe('SES-004-B: runtime SQL credential privacy', () => {
  it('does not print query parameters or database error details through its actual logger', () => {
    const service = new TypeOrmConfigService(new ConfigService());
    // Construct the actual TypeORM logger without opening a database connection.
    const source = new DataSource(service.createTypeOrmOptions() as DataSourceOptions);
    const output = ['log', 'warn', 'error', 'info', 'debug'].map((method) =>
      jest
        .spyOn(console, method as 'log' | 'warn' | 'error' | 'info' | 'debug')
        .mockImplementation(() => {}),
    );
    try {
      const credential = 'synthetic-csrf-must-not-appear-in-sql-logs';
      const query = 'INSERT INTO auth_sessions ("csrfToken") VALUES ($1)';
      source.logger.logQuery(query, [credential]);
      source.logger.logQueryError(new Error(credential), query, [credential]);
      source.logger.logQuerySlow(10000, query, [credential]);
      source.logger.log('warn', credential);
      source.logger.logMigration(credential);
      source.logger.logSchemaBuild(credential);
      for (const channel of output) expect(channel).not.toHaveBeenCalled();
    } finally {
      for (const channel of output) channel.mockRestore();
    }
  });
});
