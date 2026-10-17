import { Logger } from '@nestjs/common';
import { FxRatesService } from '../fx-rates/fx-rates.service';
import { InflationService } from '../inflation/inflation.service';
import { PortfolioSnapshotsService } from '../portfolio-snapshots/portfolio-snapshots.service';
import { PricesService } from '../prices/prices.service';
import { WalletSyncService } from '../wallet-addresses/wallet-sync.service';

const jobs = [
  ['prices', PricesService],
  ['fx', FxRatesService],
  ['inflation', InflationService],
  ['snapshots', PortfolioSnapshotsService],
  ['wallets', WalletSyncService],
] as const;

describe.each([...jobs])('JOB-ERROR-LOG: the %s scheduled tick', (_name, Service) => {
  // Only the catch is under test, so the service is built without its collaborators.
  type Job = { scheduledTick(): Promise<void>; tick(): Promise<unknown> };
  let service: Job;
  let warn: jest.SpyInstance;
  beforeEach(() => {
    service = Object.assign(Object.create(Service.prototype) as Job, {
      logger: new Logger(Service.name),
    });
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('logs the message of the error that stopped it', async () => {
    jest.spyOn(service, 'tick').mockRejectedValue(new Error('synthetic constraint violation'));
    await service.scheduledTick();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('synthetic constraint violation'));
  });

  it('says only that the cause is unknown when the thrown value is not an Error', async () => {
    jest.spyOn(service, 'tick').mockRejectedValue('synthetic body with a secret');
    await service.scheduledTick();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown'));
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('secret'));
  });
});
