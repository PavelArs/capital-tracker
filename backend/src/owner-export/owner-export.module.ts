import { Module } from '@nestjs/common';
import { OwnerExportController } from './owner-export.controller';
import { OwnerExportService } from './owner-export.service';

@Module({
  controllers: [OwnerExportController],
  providers: [OwnerExportService],
})
export class OwnerExportModule {}
