import { Injectable } from "@nestjs/common";
import { TypeOrmModuleOptions, TypeOrmOptionsFactory } from "@nestjs/typeorm";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class TypeOrmConfigService implements TypeOrmOptionsFactory {
  constructor(private configService: ConfigService) {}

  createTypeOrmOptions(): TypeOrmModuleOptions {
    return {
      type: "postgres",
      host: this.configService.get("DB_HOST", "localhost"),
      port: this.configService.get("DB_PORT", 5432),
      username: this.configService.get("DB_USERNAME", "postgres"),
      password: this.configService.get("DB_PASSWORD", "postgres"),
      database: this.configService.get("DB_NAME", "capital_tracker"),
      entities: [__dirname + "/../**/*.entity{.ts,.js}"],
      synchronize: this.configService.get("NODE_ENV") !== "production",
      logging: this.configService.get("NODE_ENV") === "development",
      migrations: [__dirname + "/../migrations/*.{.ts,.js}"],
      migrationsRun: false,
    };
  }
}
