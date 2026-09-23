import { Module } from '@nestjs/common';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';
import { CsvImportController } from './csv-import.controller';
import { CsvImportService } from './csv-import.service';
import { CsvUploadInterceptor } from './csv-upload.interceptor';
import { TradeController } from './trade.controller';
import { TradeService } from './trade.service';

@Module({
  controllers: [AccountingController, TradeController, CsvImportController],
  providers: [AccountingService, TradeService, CsvImportService, CsvUploadInterceptor],
})
export class AccountingModule {}
