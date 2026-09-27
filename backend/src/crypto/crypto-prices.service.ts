import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import axios from 'axios';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

export interface CryptoPrices {
  [symbol: string]: {
    usd: number;
    lastUpdated: Date;
  };
}

interface TokenPriceCache {
  usd: number;
  lastUpdated: Date;
}

@Injectable()
export class CryptoPricesService {
  private prices: CryptoPrices = {};
  private tokenPrices: Map<string, TokenPriceCache> = new Map();
  private readonly CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes - increased to reduce API calls
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY_MS = 5000; // 5 seconds base delay
  private isUpdatingCrypto = false;
  private isUpdatingTokens = false;
  private lastRateLimitError: Date | null = null;
  private updatePromise: Promise<void> | null = null;

  constructor(
    @InjectPinoLogger(CryptoPricesService.name)
    private readonly logger: PinoLogger,
  ) {
    if (process.env.BACKGROUND_JOBS_ENABLED !== 'false') {
      void this.updatePrices();
    }
  }

  private isCacheValid(lastUpdated: Date): boolean {
    return Date.now() - lastUpdated.getTime() < this.CACHE_TTL_MS;
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async makeApiRequestWithRetry<T>(
    requestFn: () => Promise<T>,
    retries: number = this.MAX_RETRIES,
  ): Promise<T> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await requestFn();
        // Reset rate limit error flag on success
        this.lastRateLimitError = null;
        return result;
      } catch (error: any) {
        const isRateLimit = error.response?.status === 429;

        if (isRateLimit) {
          this.lastRateLimitError = new Date();
          const retryAfter = error.response?.headers['retry-after'];
          const delay = retryAfter
            ? Number.parseInt(retryAfter) * 1000
            : this.RETRY_DELAY_MS * 2 ** attempt; // Exponential backoff

          if (attempt < retries) {
            this.logger.warn(
              { delay, attempt: attempt + 1, maxAttempts: retries + 1 },
              'Rate limit hit (429), retrying',
            );
            await this.sleep(delay);
            continue;
          }
          this.logger.error('Rate limit exceeded, max retries reached');
          throw error;
        }

        // For non-rate-limit errors, throw immediately
        throw error;
      }
    }
    throw new Error('Max retries exceeded');
  }

  @Cron('*/15 * * * *') // Every 15 minutes
  async updatePrices() {
    // If update is already in progress, return the existing promise
    if (this.updatePromise) {
      return this.updatePromise;
    }

    // If we recently hit rate limit, skip update and use cache
    if (this.lastRateLimitError && Date.now() - this.lastRateLimitError.getTime() < 5 * 60 * 1000) {
      this.logger.info('Skipping price update due to recent rate limit error, using cache');
      return Promise.resolve();
    }

    this.isUpdatingCrypto = true;
    this.updatePromise = (async () => {
      try {
        // Using CoinGecko API (free tier, no key required)
        const response = await this.makeApiRequestWithRetry(() =>
          axios.get('https://api.coingecko.com/api/v3/simple/price', {
            params: {
              ids: 'bitcoin,ethereum',
              vs_currencies: 'usd',
            },
            timeout: 10000,
          }),
        );

        if (response.data) {
          const now = new Date();
          if (response.data.bitcoin) {
            this.prices.BTC = {
              usd: response.data.bitcoin.usd,
              lastUpdated: now,
            };
            this.logger.info({ price: response.data.bitcoin.usd }, 'Updated BTC price');
          } else {
            this.logger.warn('BTC price not found in API response');
          }
          if (response.data.ethereum) {
            this.prices.ETH = {
              usd: response.data.ethereum.usd,
              lastUpdated: now,
            };
            this.logger.info({ price: response.data.ethereum.usd }, 'Updated ETH price');
          } else {
            this.logger.warn('ETH price not found in API response');
          }
        } else {
          this.logger.warn('Empty response from CoinGecko API');
        }
      } catch (error: any) {
        this.logger.error({ err: error }, 'Error updating crypto prices');
        // Don't clear cache on error - use existing cached values
      } finally {
        this.isUpdatingCrypto = false;
        this.updatePromise = null;
      }
    })();

    return this.updatePromise;
  }

  async getPrice(symbol: string): Promise<number> {
    const upperSymbol = symbol.toUpperCase();
    const cached = this.prices[upperSymbol];

    // Return cached price if valid (even if slightly expired to avoid rate limits)
    if (cached) {
      const age = Date.now() - cached.lastUpdated.getTime();
      // Use cache if valid OR if expired but less than 30 minutes old (grace period)
      if (this.isCacheValid(cached.lastUpdated) || age < 30 * 60 * 1000) {
        return cached.usd || 0;
      }
    }

    // If cache is empty or very old, try to update synchronously first
    if (!cached || Date.now() - cached.lastUpdated.getTime() > 30 * 60 * 1000) {
      // Wait for update (either start new one or wait for existing)
      try {
        await this.updatePrices();
        // Return updated price
        const updatedPrice = this.prices[upperSymbol]?.usd || 0;
        if (updatedPrice > 0) {
          return updatedPrice;
        }
        // If still 0, fall through to return cached value
      } catch (error) {
        this.logger.error({ err: error }, 'Error updating prices synchronously');
        // Fall through to return cached value if update fails
      }
    }

    // Return cached price (even if expired) as fallback
    return cached?.usd || 0;
  }

  async getTokenPrice(contractAddress: string): Promise<number> {
    const normalizedAddress = contractAddress.toLowerCase();
    const cached = this.tokenPrices.get(normalizedAddress);

    // Return cached price if valid (or if expired but less than 30 minutes old)
    if (cached) {
      const age = Date.now() - cached.lastUpdated.getTime();
      if (this.isCacheValid(cached.lastUpdated) || age < 30 * 60 * 1000) {
        return cached.usd || 0;
      }
    }

    // If we recently hit rate limit, return cached value even if expired
    if (this.lastRateLimitError && Date.now() - this.lastRateLimitError.getTime() < 5 * 60 * 1000) {
      this.logger.info('Using cached token price due to recent rate limit error');
      return cached?.usd || 0;
    }

    // If cache is invalid or missing, fetch from API
    try {
      const response = await this.makeApiRequestWithRetry(() =>
        axios.get('https://api.coingecko.com/api/v3/simple/token_price/ethereum', {
          params: {
            contract_addresses: normalizedAddress,
            vs_currencies: 'usd',
          },
          timeout: 10000,
        }),
      );

      const price = response.data[normalizedAddress]?.usd || 0;
      const now = new Date();

      // Update cache
      this.tokenPrices.set(normalizedAddress, {
        usd: price,
        lastUpdated: now,
      });

      return price;
    } catch (error: any) {
      this.logger.error({ err: error, contractAddress }, 'Error fetching token price');
      // Return cached value even if expired, if available
      return cached?.usd || 0;
    }
  }

  async getBulkTokenPrices(contractAddresses: string[]): Promise<{ [address: string]: number }> {
    if (contractAddresses.length === 0) {
      return {};
    }

    // Normalize addresses
    const normalizedAddresses = contractAddresses.map((addr) => addr.toLowerCase());

    // Check which addresses need to be fetched
    const addressesToFetch: string[] = [];
    const result: { [address: string]: number } = {};

    for (const address of normalizedAddresses) {
      const cached = this.tokenPrices.get(address);
      if (cached) {
        const age = Date.now() - cached.lastUpdated.getTime();
        // Use cache if valid OR if expired but less than 30 minutes old (grace period)
        if (this.isCacheValid(cached.lastUpdated) || age < 30 * 60 * 1000) {
          // Use cached value
          result[address] = cached.usd || 0;
        } else {
          // Need to fetch - cache is too old
          addressesToFetch.push(address);
          // Use expired cache as fallback
          result[address] = cached.usd || 0;
        }
      } else {
        // No cache - need to fetch
        addressesToFetch.push(address);
      }
    }

    // If all prices are cached and valid, return immediately
    if (addressesToFetch.length === 0) {
      return result;
    }

    // Prevent concurrent bulk updates
    if (this.isUpdatingTokens) {
      // Return what we have from cache
      return result;
    }

    // If we recently hit rate limit, return cached values
    if (this.lastRateLimitError && Date.now() - this.lastRateLimitError.getTime() < 5 * 60 * 1000) {
      this.logger.info('Using cached token prices due to recent rate limit error');
      return result;
    }

    this.isUpdatingTokens = true;
    try {
      // Fetch missing prices in bulk
      const addressesToFetchStr = addressesToFetch.join(',');
      const response = await this.makeApiRequestWithRetry(() =>
        axios.get('https://api.coingecko.com/api/v3/simple/token_price/ethereum', {
          params: {
            contract_addresses: addressesToFetchStr,
            vs_currencies: 'usd',
          },
          timeout: 10000,
        }),
      );

      const now = new Date();

      // Update cache and result with fetched prices
      for (const address of addressesToFetch) {
        const price = response.data[address]?.usd || 0;
        result[address] = price;

        // Update cache
        this.tokenPrices.set(address, {
          usd: price,
          lastUpdated: now,
        });
      }

      return result;
    } catch (error: any) {
      this.logger.error({ err: error }, 'Error fetching bulk token prices');
      // Return cached values (including expired) as fallback
      return result;
    } finally {
      this.isUpdatingTokens = false;
    }
  }

  @Cron('*/30 * * * *') // Every 30 minutes
  async invalidateTokenCache() {
    // Remove very old entries from token cache (older than 1 hour)
    const now = Date.now();
    const expiredAddresses: string[] = [];

    for (const [address, cache] of this.tokenPrices.entries()) {
      const age = now - cache.lastUpdated.getTime();
      // Only remove entries older than 1 hour
      if (age > 60 * 60 * 1000) {
        expiredAddresses.push(address);
      }
    }

    // Remove expired entries
    for (const address of expiredAddresses) {
      this.tokenPrices.delete(address);
    }

    if (expiredAddresses.length > 0) {
      this.logger.info(
        { count: expiredAddresses.length },
        'Invalidated old token price cache entries',
      );
    }
  }

  getAllPrices(): CryptoPrices {
    return this.prices;
  }

  // Method to get cache statistics (useful for debugging)
  getCacheStats(): {
    cryptoCount: number;
    tokenCount: number;
    cryptoEntries: string[];
    tokenEntries: string[];
  } {
    return {
      cryptoCount: Object.keys(this.prices).length,
      tokenCount: this.tokenPrices.size,
      cryptoEntries: Object.keys(this.prices),
      tokenEntries: Array.from(this.tokenPrices.keys()),
    };
  }
}
