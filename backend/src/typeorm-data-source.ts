import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';

// Load environment variables from .env file
dotenv.config();

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'capital_tracker',
  entities: ['dist/**/*.entity.js'],
  migrations: ['dist/migrations/*.js'],
});
