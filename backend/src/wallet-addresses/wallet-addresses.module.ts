import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountingModule } from '../accounting/accounting.module';
import { BitcoinSyncAdapter } from './bitcoin-sync.adapter';
import { BybitClient } from './bybit-client';
import { BybitKeyBox } from './bybit-key-box';
import { BybitSyncAdapter } from './bybit-sync.adapter';
import { CHAIN_SYNC_ADAPTERS, type ChainSyncAdapter } from './chain-sync';
import { EsploraClient } from './esplora-client';
import { EthereumSyncAdapter } from './ethereum-sync.adapter';
import { EtherscanClient } from './etherscan-client';
import { SolanaRpcClient } from './solana-rpc-client';
import { SolanaSyncAdapter } from './solana-sync.adapter';
import { TronSyncAdapter } from './tron-sync.adapter';
import { TronGridClient } from './trongrid-client';
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
    BybitSyncAdapter,
    TronSyncAdapter,
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
    // TronGrid answers without a key at a low rate; a free key from the server's environment
    // raises it (TRON-SYNC).
    {
      provide: TronGridClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new TronGridClient({ apiKey: config.get<string>('TRONGRID_API_KEY') ?? null }),
    },
    // Bybit (M22): the owner's read-only key is stored per account, sealed with the MFA key.
    { provide: BybitClient, useFactory: () => new BybitClient() },
    {
      provide: BybitKeyBox,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new BybitKeyBox(config),
    },
    // One adapter per network.
    {
      provide: CHAIN_SYNC_ADAPTERS,
      inject: [
        BitcoinSyncAdapter,
        EthereumSyncAdapter,
        SolanaSyncAdapter,
        BybitSyncAdapter,
        TronSyncAdapter,
      ],
      useFactory: (
        bitcoin: BitcoinSyncAdapter,
        ethereum: EthereumSyncAdapter,
        solana: SolanaSyncAdapter,
        bybit: BybitSyncAdapter,
        tron: TronSyncAdapter,
      ): ChainSyncAdapter[] => [bitcoin, ethereum, solana, bybit, tron],
    },
  ],
})
export class WalletAddressesModule {}
