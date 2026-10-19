import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountingModule } from '../accounting/accounting.module';
import { BrokerConnectionsController } from './broker-connections.controller';
import { BrokerConnectionsService } from './broker-connections.service';
import { BrokerImportService } from './broker-import.service';
import { BrokerSetupController } from './broker-setup.controller';
import { BrokerSetupService } from './broker-setup.service';
import { russianTrustedRootCa } from './russian-trusted-root-ca';
import { TBankClient } from './tbank-client';
import { TBankTokenBox } from './tbank-token-box';

@Module({
  imports: [AccountingModule],
  controllers: [BrokerConnectionsController, BrokerSetupController],
  providers: [
    BrokerConnectionsService,
    BrokerImportService,
    BrokerSetupService,
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
