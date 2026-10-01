import axios from 'axios';
import { PinoLogger } from 'nestjs-pino';
import { ExchangeRatesCacheService } from '../cache/exchange-rates-cache.service';
import { CryptoPricesService } from '../crypto/crypto-prices.service';
import { CurrencyUpdateService } from '../currencies/currency-update.service';

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as PinoLogger;
let originalBackground: string | undefined;
beforeEach(() => {
  originalBackground = process.env.BACKGROUND_JOBS_ENABLED;
});
afterEach(() => {
  if (originalBackground === undefined)
    Reflect.deleteProperty(process.env, 'BACKGROUND_JOBS_ENABLED');
  else process.env.BACKGROUND_JOBS_ENABLED = originalBackground;
  jest.restoreAllMocks();
});
function services() {
  const crypto = { getPrice: jest.fn().mockResolvedValue(100) } as unknown as CryptoPricesService;
  const cache = {
    getExchangeRates: jest.fn().mockResolvedValue(null),
    getCryptoRates: jest.fn().mockResolvedValue(null),
    setExchangeRates: jest.fn().mockResolvedValue(undefined),
  } as unknown as ExchangeRatesCacheService;
  return new CurrencyUpdateService(crypto, cache, logger);
}
describe('MVP-001: configured manual startup', () => {
  it('MVP-001-B enabled fiat collection has a bounded HTTP timeout', async () => {
    process.env.BACKGROUND_JOBS_ENABLED = 'true';
    const request = jest.spyOn(axios, 'get').mockResolvedValue({ data: { rates: { USD: 1 } } });
    await services().updateExchangeRates();
    expect(request).toHaveBeenCalledWith('https://api.exchangerate-api.com/v4/latest/USD', {
      timeout: 10000,
    });
  });
  it('MVP-001-A false prevents automatic crypto price collection at construction', () => {
    process.env.BACKGROUND_JOBS_ENABLED = 'false';
    const collect = jest
      .spyOn(CryptoPricesService.prototype, 'updatePrices')
      .mockResolvedValue(undefined);
    new CryptoPricesService(logger);
    expect(collect).not.toHaveBeenCalled();
  });
  it('MVP-001-A false prevents automatic fiat/crypto collection at module initialization', async () => {
    process.env.BACKGROUND_JOBS_ENABLED = 'false';
    const fiat = jest
      .spyOn(CurrencyUpdateService.prototype, 'updateExchangeRates')
      .mockResolvedValue(undefined);
    const crypto = jest
      .spyOn(CurrencyUpdateService.prototype, 'updateCryptoRates')
      .mockResolvedValue(undefined);
    await services().onModuleInit();
    expect(fiat).not.toHaveBeenCalled();
    expect(crypto).not.toHaveBeenCalled();
  });
  it.each(['true', undefined])(
    'MVP-001-B preserves automatic startup when configured %p',
    async (enabled) => {
      if (enabled === undefined) Reflect.deleteProperty(process.env, 'BACKGROUND_JOBS_ENABLED');
      else process.env.BACKGROUND_JOBS_ENABLED = enabled;
      const prices = jest
        .spyOn(CryptoPricesService.prototype, 'updatePrices')
        .mockResolvedValue(undefined);
      const fiat = jest
        .spyOn(CurrencyUpdateService.prototype, 'updateExchangeRates')
        .mockResolvedValue(undefined);
      const crypto = jest
        .spyOn(CurrencyUpdateService.prototype, 'updateCryptoRates')
        .mockResolvedValue(undefined);
      new CryptoPricesService(logger);
      await services().onModuleInit();
      expect(prices).toHaveBeenCalledTimes(1);
      expect(fiat).toHaveBeenCalledTimes(1);
      expect(crypto).toHaveBeenCalledTimes(1);
    },
  );
});
