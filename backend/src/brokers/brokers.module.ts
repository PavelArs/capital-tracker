import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrokerConnectionsController } from './broker-connections.controller';
import { BrokerConnectionsService } from './broker-connections.service';
import { russianTrustedRootCa } from './russian-trusted-root-ca';
import { TBankClient } from './tbank-client';
import { TBankTokenBox } from './tbank-token-box';

@Module({
  controllers: [BrokerConnectionsController],
  providers: [
    BrokerConnectionsService,
    {
      provide: TBankClient,
      useFactory: () => new TBankClient({ extraRoots: [russianTrustedRootCa] }),
    },
    {
      provide: TBankTokenBox,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new TBankTokenBox(config),
    },
  ],
})
export class BrokersModule {}
