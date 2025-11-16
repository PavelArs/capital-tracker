import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import axios from "axios";

@Injectable()
export class CurrencyUpdateService {
  private exchangeRates: Record<string, number> = {};
  private cryptoRates: Record<string, number> = {}; // BTC, ETH в USD
  private lastUpdate: Date;
  private lastCryptoUpdate: Date;

  constructor() {
    // Initialize on startup
    this.updateExchangeRates();
    this.updateCryptoRates();
  }

  @Cron(CronExpression.EVERY_HOUR)
  async updateExchangeRates() {
    try {
      // Using ExchangeRate-API (free tier, no key required for basic usage)
      const response = await axios.get(
        "https://api.exchangerate-api.com/v4/latest/USD"
      );
      this.exchangeRates = response.data.rates;
      this.lastUpdate = new Date();
    } catch (error) {
      console.error("Error updating exchange rates:", error.message);
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async updateCryptoRates() {
    try {
      // Get crypto prices in USD from CoinGecko
      const response = await axios.get(
        "https://api.coingecko.com/api/v3/simple/price",
        {
          params: {
            ids: "bitcoin,ethereum,tether",
            vs_currencies: "usd",
          },
          timeout: 10000,
        }
      );

      if (response.data) {
        this.cryptoRates = {
          BTC: response.data.bitcoin?.usd || 0,
          ETH: response.data.ethereum?.usd || 0,
          USDT: response.data.tether?.usd || 1,
        };
        this.lastCryptoUpdate = new Date();
        console.log("Updated crypto rates:", this.cryptoRates);
      }
    } catch (error) {
      console.error("Error updating crypto rates:", error.message);
    }
  }

  async getExchangeRates(
    baseCurrency: string = "USD"
  ): Promise<Record<string, number>> {
    // Update if rates are old or empty
    if (!this.lastUpdate || Date.now() - this.lastUpdate.getTime() > 3600000) {
      await this.updateExchangeRates();
    }
    if (
      !this.lastCryptoUpdate ||
      Date.now() - this.lastCryptoUpdate.getTime() > 600000
    ) {
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

    if (baseCurrency === "USD") {
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
