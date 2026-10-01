import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions, TypeOrmOptionsFactory } from '@nestjs/typeorm';

@Injectable()
export class TypeOrmConfigService implements TypeOrmOptionsFactory {
  constructor(private configService: ConfigService) {}

  createTypeOrmOptions(): TypeOrmModuleOptions {
    return {
      type: 'postgres',
      connectTimeoutMS: 5000,
      host: this.configService.get('DB_HOST', 'localhost'),
      port: this.configService.get('DB_PORT', 5432),
      username: this.configService.get('DB_USERNAME', 'postgres'),
      password: this.configService.get('DB_PASSWORD', 'postgres'),
      database: this.configService.get('DB_NAME', 'capital_tracker'),
      entities: [`${__dirname}/../**/*.entity{.ts,.js}`],
      synchronize: false, // Always false - use migrations instead
      logging: false,
      logger: {
        log: () => {},
        logQuery: () => {},
        logQueryError: () => {},
        logQuerySlow: () => {},
        logSchemaBuild: () => {},
        logMigration: () => {},
      },
      migrations: [`${__dirname}/../migrations/*{.ts,.js}`],
      migrationsRun: false, // Migrations run only through the explicit release command.
      installExtensions: false, // Runtime connections never provision database extensions.
    };
  }
}
