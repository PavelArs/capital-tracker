import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import axios from 'axios';

export interface CryptoPrices {
  [symbol: string]: {
    usd: number;
    lastUpdated: Date;
  };
}

@Injectable()
export class CryptoPricesService {
  private prices: CryptoPrices = {};

  constructor() {
    // Initialize on startup
    this.updatePrices();
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async updatePrices() {
    try {
      // Using CoinGecko API (free tier, no key required)
      const response = await axios.get(
        'https://api.coingecko.com/api/v3/simple/price',
        {
          params: {
            ids: 'bitcoin,ethereum',
            vs_currencies: 'usd',
          },
          timeout: 10000,
        },
      );

      if (response.data) {
        if (response.data.bitcoin) {
          this.prices['BTC'] = {
            usd: response.data.bitcoin.usd,
            lastUpdated: new Date(),
          };
        }
        if (response.data.ethereum) {
          this.prices['ETH'] = {
            usd: response.data.ethereum.usd,
            lastUpdated: new Date(),
          };
        }
        console.log('Updated crypto prices:', this.prices);
      }
    } catch (error) {
      console.error('Error updating crypto prices:', error.message);
    }
  }

  async getPrice(symbol: string): Promise<number> {
    const upperSymbol = symbol.toUpperCase();
    
    // If price is not in cache or too old, update
    if (!this.prices[upperSymbol] || 
        Date.now() - this.prices[upperSymbol].lastUpdated.getTime() > 600000) {
      await this.updatePrices();
    }

    return this.prices[upperSymbol]?.usd || 0;
  }

  async getTokenPrice(contractAddress: string): Promise<number> {
    try {
      // Using CoinGecko API to get token price by contract address
      const response = await axios.get(
        `https://api.coingecko.com/api/v3/simple/token_price/ethereum`,
        {
          params: {
            contract_addresses: contractAddress.toLowerCase(),
            vs_currencies: 'usd',
          },
          timeout: 10000,
        },
      );

      const price = response.data[contractAddress.toLowerCase()]?.usd;
      return price || 0;
    } catch (error) {
      console.error(`Error fetching token price for ${contractAddress}:`, error.message);
      return 0;
    }
  }

  async getBulkTokenPrices(contractAddresses: string[]): Promise<{ [address: string]: number }> {
    if (contractAddresses.length === 0) {
      return {};
    }

    try {
      const addresses = contractAddresses.map(addr => addr.toLowerCase()).join(',');
      const response = await axios.get(
        `https://api.coingecko.com/api/v3/simple/token_price/ethereum`,
        {
          params: {
            contract_addresses: addresses,
            vs_currencies: 'usd',
          },
          timeout: 10000,
        },
      );

      const prices: { [address: string]: number } = {};
      for (const [address, data] of Object.entries(response.data)) {
        prices[address] = (data as any).usd || 0;
      }
      return prices;
    } catch (error) {
      console.error('Error fetching bulk token prices:', error.message);
      return {};
    }
  }

  getAllPrices(): CryptoPrices {
    return this.prices;
  }
}

