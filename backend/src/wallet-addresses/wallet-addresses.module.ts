import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountingModule } from '../accounting/accounting.module';
import { BitcoinSyncAdapter } from './bitcoin-sync.adapter';
import { CHAIN_SYNC_ADAPTERS, type ChainSyncAdapter } from './chain-sync';
import { EsploraClient } from './esplora-client';
import { EthereumSyncAdapter } from './ethereum-sync.adapter';
import { EtherscanClient } from './etherscan-client';
import { SolanaRpcClient } from './solana-rpc-client';
import { SolanaSyncAdapter } from './solana-sync.adapter';
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
    SolanaSyncAdapter,
    { provide: EsploraClient, useFactory: () => new EsploraClient() },
    // The free Etherscan key (Q6) comes from the server's environment, never from the code.
    {
      provide: EtherscanClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new EtherscanClient({ apiKey: config.get<string>('ETHERSCAN_API_KEY') ?? null }),
    },
    // Solana's public endpoint needs no key (M15).
    { provide: SolanaRpcClient, useFactory: () => new SolanaRpcClient() },
    // One adapter per network.
    {
      provide: CHAIN_SYNC_ADAPTERS,
      inject: [BitcoinSyncAdapter, EthereumSyncAdapter, SolanaSyncAdapter],
      useFactory: (
        bitcoin: BitcoinSyncAdapter,
        ethereum: EthereumSyncAdapter,
        solana: SolanaSyncAdapter,
      ): ChainSyncAdapter[] => [bitcoin, ethereum, solana],
    },
  ],
})
export class WalletAddressesModule {}
