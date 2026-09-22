import { join } from 'node:path';
import { DataSource } from 'typeorm';

// Environment loading is the caller's responsibility; never silently target a local DB.
for (const name of ['DB_HOST', 'DB_PORT', 'DB_USERNAME', 'DB_PASSWORD', 'DB_NAME']) {
  if (!process.env[name]) throw new Error(`Missing required migration setting: ${name}`);
}
const port = Number(process.env.DB_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('Invalid migration DB_PORT');
}

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port,
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  entities: [join(__dirname, '**/*.entity.js')],
  migrations: [join(__dirname, 'migrations/*.js')],
  synchronize: false,
  migrationsRun: false,
  installExtensions: false,
  logging: false,
  // TypeORM logs migration errors even with logging:false. The CLI owns safe summaries.
  logger: {
    log: () => {},
    logQuery: () => {},
    logQueryError: () => {},
    logQuerySlow: () => {},
    logSchemaBuild: () => {},
    logMigration: () => {},
  },
});
