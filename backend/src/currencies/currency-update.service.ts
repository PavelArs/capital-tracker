import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import axios from 'axios';
import { CryptoPricesService } from '../crypto/crypto-prices.service';

@Injectable()
export class CurrencyUpdateService {
  private exchangeRates: Record<string, number> = {};
  private cryptoRates: Record<string, number> = {}; // BTC, ETH в USD
  private lastUpdate: Date;
  private lastCryptoUpdate: Date;

  constructor(
    @Inject(forwardRef(() => CryptoPricesService))
    private cryptoPricesService: CryptoPricesService,
  ) {
    // Initialize on startup
    this.updateExchangeRates();
    this.updateCryptoRates();
  }

  @Cron(CronExpression.EVERY_HOUR)
  async updateExchangeRates() {
    try {
      // Using ExchangeRate-API (free tier, no key required for basic usage)
      const response = await axios.get('https://api.exchangerate-api.com/v4/latest/USD');
      this.exchangeRates = response.data.rates;
      this.lastUpdate = new Date();
    } catch (error) {
      console.error('Error updating exchange rates:', error.message);
    }
  }

  @Cron('*/15 * * * *') // Every 15 minutes
  async updateCryptoRates() {
    try {
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
      console.log('Updated crypto rates from cache:', this.cryptoRates);
    } catch (error) {
      console.error('Error updating crypto rates:', error.message);
      // Keep existing rates on error
    }
  }

  async getExchangeRates(baseCurrency: string = 'USD'): Promise<Record<string, number>> {
    // Update if rates are old or empty
    if (!this.lastUpdate || Date.now() - this.lastUpdate.getTime() > 3600000) {
      await this.updateExchangeRates();
    }
    if (!this.lastCryptoUpdate || Date.now() - this.lastCryptoUpdate.getTime() > 600000) {
      await this.updateCryptoRates();
    }

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
}
