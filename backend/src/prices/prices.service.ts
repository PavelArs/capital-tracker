import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { CoinGeckoClient, KrakenClient } from './price-providers';

export type CollectionResult =
  | { outcome: 'collected'; stored: number; backfilled: number }
  | { outcome: 'busy' | 'disabled' | 'not_due' };

@Injectable()
export class PricesService {
  constructor(
    readonly source: DataSource,
    readonly config: ConfigService,
    readonly kraken: KrakenClient,
    readonly coingecko: CoinGeckoClient,
  ) {}

  async tick(_now = new Date()): Promise<CollectionResult> {
    return { outcome: 'disabled' };
  }

  async collect(_now = new Date()): Promise<CollectionResult> {
    return { outcome: 'collected', stored: 0, backfilled: 0 };
  }

  async read(_now = new Date()) {
    return { quoteCurrency: 'USD', assets: [], sources: [] };
  }
}
