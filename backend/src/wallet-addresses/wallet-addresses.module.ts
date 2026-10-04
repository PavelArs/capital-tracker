import { Module } from '@nestjs/common';
import { TradeService } from '../accounting/trade.service';
import { EsploraClient } from './esplora-client';
import { WalletAddressTradeService } from './wallet-address-trade.service';
import { WalletAddressController } from './wallet-address.controller';
import { WalletAddressService } from './wallet-address.service';

@Module({
  controllers: [WalletAddressController],
  providers: [
    WalletAddressService,
    WalletAddressTradeService,
    TradeService,
    { provide: EsploraClient, useFactory: () => new EsploraClient() },
  ],
})
export class WalletAddressesModule {}
