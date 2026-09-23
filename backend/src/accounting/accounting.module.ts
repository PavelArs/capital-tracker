import { Module } from '@nestjs/common';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';
import { CarryInController } from './carry-in.controller';
import { CarryInService } from './carry-in.service';
import { CsvImportController } from './csv-import.controller';
import { CsvImportService } from './csv-import.service';
import { CsvUploadInterceptor } from './csv-upload.interceptor';
import { TradeController } from './trade.controller';
import { TradeService } from './trade.service';

@Module({
  controllers: [AccountingController, TradeController, CsvImportController, CarryInController],
  providers: [
    AccountingService,
    TradeService,
    CsvImportService,
    CsvUploadInterceptor,
    CarryInService,
  ],
})
export class AccountingModule {}
