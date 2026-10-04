import { Module } from '@nestjs/common';
import { EsploraClient } from './esplora-client';
import { WalletAddressController } from './wallet-address.controller';
import { WalletAddressService } from './wallet-address.service';

@Module({
  controllers: [WalletAddressController],
  providers: [
    WalletAddressService,
    { provide: EsploraClient, useFactory: () => new EsploraClient() },
  ],
})
export class WalletAddressesModule {}
