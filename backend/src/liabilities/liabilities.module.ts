import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Liability } from '../entities/liability.entity';
import { LiabilitiesController } from './liabilities.controller';
import { LiabilitiesService } from './liabilities.service';

@Module({
  imports: [TypeOrmModule.forFeature([Liability])],
  controllers: [LiabilitiesController],
  providers: [LiabilitiesService],
  exports: [LiabilitiesService],
})
export class LiabilitiesModule {}
