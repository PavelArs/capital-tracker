import { Injectable, Inject, forwardRef, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PinoLogger, InjectPinoLogger } from 'nestjs-pino';
import axios from 'axios';
import { CryptoPricesService } from '../crypto/crypto-prices.service';
import { ExchangeRatesCacheService } from '../cache/exchange-rates-cache.service';

@Injectable()
export class CurrencyUpdateService implements OnModuleInit {
  private exchangeRates: Record<string, number> = {};
  private cryptoRates: Record<string, number> = {}; // BTC, ETH in USD
  private lastUpdate: Date;
  private lastCryptoUpdate: Date;

  constructor(
    @Inject(forwardRef(() => CryptoPricesService))
    private cryptoPricesService: CryptoPricesService,
    private exchangeRatesCacheService: ExchangeRatesCacheService,
    @InjectPinoLogger(CurrencyUpdateService.name)
    private readonly logger: PinoLogger,
  ) {}

  async onModuleInit(): Promise<void> {
    // Initialize on startup - try to load from cache first, then fetch if needed
    await this.initializeRates();
  }

  private async initializeRates(): Promise<void> {
    // Try to load exchange rates from cache
    const cachedExchangeRates = await this.exchangeRatesCacheService.getExchangeRates('USD');
    if (cachedExchangeRates) {
      this.exchangeRates = cachedExchangeRates.rates;
      this.lastUpdate = new Date(cachedExchangeRates.cachedAt);
      this.logger.info(
        {
          cachedAt: cachedExchangeRates.cachedAt,
          ratesCount: Object.keys(cachedExchangeRates.rates).length,
        },
        'Loaded exchange rates from cache',
      );
    } else {
      await this.updateExchangeRates();
    }

    // Try to load crypto rates from cache
    const cachedCryptoRates = await this.exchangeRatesCacheService.getCryptoRates();
    if (cachedCryptoRates) {
      this.cryptoRates = cachedCryptoRates;
      this.lastCryptoUpdate = new Date();
      this.logger.info({ rates: cachedCryptoRates }, 'Loaded crypto rates from cache');
    } else {
      await this.updateCryptoRates();
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async updateExchangeRates(): Promise<void> {
    try {
      this.logger.info('Fetching exchange rates from API');

      // Using ExchangeRate-API (free tier, no key required for basic usage)
      const response = await axios.get('https://api.exchangerate-api.com/v4/latest/USD');
      this.exchangeRates = response.data.rates;
      this.lastUpdate = new Date();

      // Cache the rates in Redis
      await this.exchangeRatesCacheService.setExchangeRates('USD', this.exchangeRates);

      this.logger.info(
        { ratesCount: Object.keys(this.exchangeRates).length },
        'Exchange rates updated and cached successfully',
      );
    } catch (error) {
      this.logger.error({ error: error.message }, 'Error updating exchange rates');
    }
  }

  @Cron('*/15 * * * *') // Every 15 minutes
  async updateCryptoRates(): Promise<void> {
    try {
      this.logger.info('Fetching crypto rates');

      // Use CryptoPricesService instead of direct CoinGecko API calls
      // This uses cached prices and reduces API requests
      const btcPrice = await this.cryptoPricesService.getPrice('BTC');
      const ethPrice = await this.cryptoPricesService.getPrice('ETH');

      // USDT is typically 1 USD, but we can try to get it from token prices if needed
      // For now, default to 1
      const usdtPrice = 1;

      this.cryptoRates = {
        BTC: btcPrice || 0,
        ETH: ethPrice || 0,
        USDT: usdtPrice,
      };
      this.lastCryptoUpdate = new Date();

      // Cache crypto rates in Redis
      await this.exchangeRatesCacheService.setCryptoRates(this.cryptoRates);

      this.logger.info({ rates: this.cryptoRates }, 'Updated and cached crypto rates');
    } catch (error) {
      this.logger.error({ error: error.message }, 'Error updating crypto rates');
      // Keep existing rates on error
    }
  }

  async getExchangeRates(baseCurrency: string = 'USD'): Promise<Record<string, number>> {
    const cacheTtl = this.exchangeRatesCacheService.getCacheTtl();

    // Try to load fiat rates from Redis cache
    const cachedFiatRates = await this.exchangeRatesCacheService.getExchangeRates('USD');
    if (cachedFiatRates && this.isCacheValid(cachedFiatRates.cachedAt, cacheTtl)) {
      this.exchangeRates = cachedFiatRates.rates;
      this.lastUpdate = new Date(cachedFiatRates.cachedAt);
      this.logger.debug({ fromCache: true }, 'Loaded fiat rates from Redis cache');
    } else if (!this.lastUpdate || Date.now() - this.lastUpdate.getTime() > cacheTtl) {
      await this.updateExchangeRates();
    }

    // Try to load crypto rates from Redis cache
    const cachedCryptoRates = await this.exchangeRatesCacheService.getCryptoRates();
    if (cachedCryptoRates && Object.keys(cachedCryptoRates).length > 0) {
      this.cryptoRates = cachedCryptoRates;
      this.lastCryptoUpdate = new Date();
      this.logger.debug({ fromCache: true }, 'Loaded crypto rates from Redis cache');
    } else if (!this.lastCryptoUpdate || Date.now() - this.lastCryptoUpdate.getTime() > cacheTtl) {
      await this.updateCryptoRates();
    }

    // Build normalized rates combining fiat + crypto
    const normalizedRates = this.buildNormalizedRates(baseCurrency);

    return normalizedRates;
  }

  private buildNormalizedRates(baseCurrency: string): Record<string, number> {
    // For crypto currencies, the rate is "how many USD for 1 crypto"
    // For fiat currencies from exchange API, the rate is "how many CURRENCY for 1 USD"
    // We need to normalize everything to "how many CURRENCY for 1 USD"

    const normalizedRates: Record<string, number> = {
      USD: 1,
      ...this.exchangeRates, // EUR: 0.92 means 1 USD = 0.92 EUR
    };

    // Add crypto rates (they come as "1 BTC = 45000 USD", so we need inverse)
    // We want "how many BTC for 1 USD" = 1/45000
    for (const [code, priceInUSD] of Object.entries(this.cryptoRates)) {
      if (priceInUSD && priceInUSD > 0) {
        normalizedRates[code] = 1 / priceInUSD; // 1 USD = 0.0000222 BTC
      }
    }

    if (baseCurrency === 'USD') {
      return normalizedRates;
    }

    // Get the rate for base currency
    const baseRate = normalizedRates[baseCurrency];
    if (!baseRate || baseRate === 0) {
      throw new Error(`Currency ${baseCurrency} rate not available`);
    }

    // Convert all rates to base currency
    const convertedRates: Record<string, number> = {};
    convertedRates[baseCurrency] = 1;

    for (const [currency, rateInUSD] of Object.entries(normalizedRates)) {
      if (currency !== baseCurrency) {
        // If base is EUR (0.92 USD per EUR) and we want to know RUB per EUR:
        // rateInUSD for RUB = 0.011 (1 USD = 0.011 RUB)
        // baseRate = 0.92 (1 USD = 0.92 EUR)
        // result = 0.011 / 0.92 = 0.012 (1 EUR = 0.012 RUB)
        convertedRates[currency] = rateInUSD / baseRate;
      }
    }

    return convertedRates;
  }

  private isCacheValid(cachedAt: number, ttl: number): boolean {
    return Date.now() - cachedAt < ttl;
  }
}
