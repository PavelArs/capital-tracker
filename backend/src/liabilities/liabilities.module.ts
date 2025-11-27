import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LiabilitiesController } from './liabilities.controller';
import { LiabilitiesService } from './liabilities.service';
import { Liability } from '../entities/liability.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Liability])],
  controllers: [LiabilitiesController],
  providers: [LiabilitiesService],
  exports: [LiabilitiesService],
})
export class LiabilitiesModule {}
