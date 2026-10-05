import { Module } from '@nestjs/common';
import { CbrClient } from './cbr-client';
import { FxRatesController } from './fx-rates.controller';
import { FxRatesService } from './fx-rates.service';

@Module({
  controllers: [FxRatesController],
  providers: [FxRatesService, { provide: CbrClient, useFactory: () => new CbrClient() }],
})
export class FxRatesModule {}
