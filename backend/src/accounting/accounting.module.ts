import { Module } from '@nestjs/common';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';
import { AssetRewardController } from './asset-reward.controller';
import { AssetRewardService } from './asset-reward.service';
import { AssetSwapService } from './asset-swap.service';
import { AuditHistoryController } from './audit-history.controller';
import { AuditHistoryService } from './audit-history.service';
import { CarryInService } from './carry-in.service';
import { ChainClassificationController } from './chain-classification.controller';
import { ChainClassificationService } from './chain-classification.service';
import { CsvImportService } from './csv-import.service';
import { HistoricalAccountingService } from './historical-accounting.service';
import { HistoricalValuationController } from './historical-valuation.controller';
import { HistoricalValuationService } from './historical-valuation.service';
import { ManualPortfolioValuationService } from './manual-portfolio-valuation.service';
import { ManualPriceController } from './manual-price.controller';
import { ManualPriceService } from './manual-price.service';
import { OperationListController } from './operation-list.controller';
import { OperationListService } from './operation-list.service';
import { OwnedTransferController } from './owned-transfer.controller';
import { OwnedTransferService } from './owned-transfer.service';
import { PortfolioFlowController } from './portfolio-flow.controller';
import { PortfolioFlowService } from './portfolio-flow.service';
import { PortfolioValuationController } from './portfolio-valuation.controller';
import { PortfolioValuationService } from './portfolio-valuation.service';
import { TradeController } from './trade.controller';
import { TradeService } from './trade.service';
import { ValuationHistoryService } from './valuation-history.service';

@Module({
  controllers: [
    AccountingController,
    TradeController,
    PortfolioFlowController,
    ManualPriceController,
    HistoricalValuationController,
    OwnedTransferController,
    AssetRewardController,
    PortfolioValuationController,
    OperationListController,
    AuditHistoryController,
    ChainClassificationController,
  ],
  providers: [
    AccountingService,
    TradeService,
    CsvImportService,
    CarryInService,
    HistoricalAccountingService,
    PortfolioFlowService,
    ManualPriceService,
    HistoricalValuationService,
    ValuationHistoryService,
    ManualPortfolioValuationService,
    OwnedTransferService,
    AssetRewardService,
    AssetSwapService,
    PortfolioValuationService,
    OperationListService,
    AuditHistoryService,
    ChainClassificationService,
  ],
  // Wallet sync links own transfers after each pass (M13, D7).
  exports: [ChainClassificationService],
})
export class AccountingModule {}
