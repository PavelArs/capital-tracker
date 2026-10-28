import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { BrokerPriceSyncService } from '../brokers/broker-price-sync.service';
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
  ['broker-prices', BrokerPriceSyncService],
] as const;

describe('ISO-005-B: the scheduled jobs', () => {
  const sources = (readdirSync(join(__dirname, '..'), { recursive: true }) as string[])
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
    .map((file) => readFileSync(join(__dirname, '..', file), 'utf8'));
  const count = (decorator: string) =>
    sources.reduce((total, source) => total + source.split(`@${decorator}(`).length - 1, 0);

  it('are exactly the six interval jobs listed here, with no cron or timeout jobs', () => {
    expect(count('Interval')).toBe(jobs.length);
    expect(count('Cron')).toBe(0);
    expect(count('Timeout')).toBe(0);
    for (const [, Service] of jobs) {
      expect(
        Reflect.getMetadata('SCHEDULE_INTERVAL_OPTIONS', Service.prototype.scheduledTick),
      ).toEqual({
        timeout: expect.any(Number),
      });
    }
  });
});

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

  it.each([undefined, 'false'])(
    'ISO-005-B does no work while PRICE_COLLECTION_ENABLED is %s',
    async (setting) => {
      // Every other collaborator is absent, so any work past the switch would throw.
      const config = {
        get: (key: string) => (key === 'PRICE_COLLECTION_ENABLED' ? setting : undefined),
      };
      Object.assign(service, { config });
      await expect(service.tick()).resolves.toEqual({ outcome: 'disabled' });
    },
  );

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
