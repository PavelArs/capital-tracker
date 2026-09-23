import { Module } from '@nestjs/common';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';
import { TradeController } from './trade.controller';
import { TradeService } from './trade.service';

@Module({
  controllers: [AccountingController, TradeController],
  providers: [AccountingService, TradeService],
})
export class AccountingModule {}
