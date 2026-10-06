import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { BitcoinSyncAdapter } from './bitcoin-sync.adapter';
import { CHAIN_SYNC_ADAPTERS, type ChainSyncAdapter } from './chain-sync';
import { EsploraClient } from './esplora-client';
import { WalletAddressController } from './wallet-address.controller';
import { WalletAddressService } from './wallet-address.service';
import { WalletSyncService } from './wallet-sync.service';

@Module({
  imports: [AccountingModule],
  controllers: [WalletAddressController],
  providers: [
    WalletAddressService,
    WalletSyncService,
    BitcoinSyncAdapter,
    { provide: EsploraClient, useFactory: () => new EsploraClient() },
    // One adapter per network; Ethereum (M14) and Solana (M15) join this list.
    {
      provide: CHAIN_SYNC_ADAPTERS,
      inject: [BitcoinSyncAdapter],
      useFactory: (bitcoin: BitcoinSyncAdapter): ChainSyncAdapter[] => [bitcoin],
    },
  ],
})
export class WalletAddressesModule {}
