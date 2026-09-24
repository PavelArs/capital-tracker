import { Module } from '@nestjs/common';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';
import { CarryInController } from './carry-in.controller';
import { CarryInService } from './carry-in.service';
import { CsvImportController } from './csv-import.controller';
import { CsvImportService } from './csv-import.service';
import { CsvUploadInterceptor } from './csv-upload.interceptor';
import { HistoricalAccountingService } from './historical-accounting.service';
import { HistoricalValuationController } from './historical-valuation.controller';
import { HistoricalValuationService } from './historical-valuation.service';
import { ManualPortfolioValuationController } from './manual-portfolio-valuation.controller';
import { ManualPortfolioValuationService } from './manual-portfolio-valuation.service';
import { ManualPriceController } from './manual-price.controller';
import { ManualPriceService } from './manual-price.service';
import { PortfolioFlowController } from './portfolio-flow.controller';
import { PortfolioFlowService } from './portfolio-flow.service';
import { TradeController } from './trade.controller';
import { TradeService } from './trade.service';
import { ValuationHistoryController } from './valuation-history.controller';
import { ValuationHistoryService } from './valuation-history.service';

@Module({
  controllers: [
    AccountingController,
    TradeController,
    CsvImportController,
    CarryInController,
    PortfolioFlowController,
    ManualPriceController,
    HistoricalValuationController,
    ValuationHistoryController,
    ManualPortfolioValuationController,
  ],
  providers: [
    AccountingService,
    TradeService,
    CsvImportService,
    CsvUploadInterceptor,
    CarryInService,
    HistoricalAccountingService,
    PortfolioFlowService,
    ManualPriceService,
    HistoricalValuationService,
    ValuationHistoryService,
    ManualPortfolioValuationService,
  ],
})
export class AccountingModule {}
