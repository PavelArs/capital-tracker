import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountingModule } from '../accounting/accounting.module';
import { BitcoinSyncAdapter } from './bitcoin-sync.adapter';
import { CHAIN_SYNC_ADAPTERS, type ChainSyncAdapter } from './chain-sync';
import { EsploraClient } from './esplora-client';
import { EthereumSyncAdapter } from './ethereum-sync.adapter';
import { EtherscanClient } from './etherscan-client';
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
    EthereumSyncAdapter,
    { provide: EsploraClient, useFactory: () => new EsploraClient() },
    // The free Etherscan key (Q6) comes from the server's environment, never from the code.
    {
      provide: EtherscanClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new EtherscanClient({ apiKey: config.get<string>('ETHERSCAN_API_KEY') ?? null }),
    },
    // One adapter per network; Solana (M15) joins this list.
    {
      provide: CHAIN_SYNC_ADAPTERS,
      inject: [BitcoinSyncAdapter, EthereumSyncAdapter],
      useFactory: (
        bitcoin: BitcoinSyncAdapter,
        ethereum: EthereumSyncAdapter,
      ): ChainSyncAdapter[] => [bitcoin, ethereum],
    },
  ],
})
export class WalletAddressesModule {}
