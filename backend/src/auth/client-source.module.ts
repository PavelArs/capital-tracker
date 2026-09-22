import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthClientSourceService } from './client-source';

@Module({
  imports: [ConfigModule],
  providers: [AuthClientSourceService],
  exports: [AuthClientSourceService],
})
export class AuthClientSourceModule {}
