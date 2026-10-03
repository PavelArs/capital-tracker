import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EsploraClient } from './esplora-client';

// RED stub: replaced by the implementation in tasks 2.2-2.4.
@Injectable()
export class WalletAddressService {
  constructor(
    private readonly source: DataSource,
    private readonly esplora: EsploraClient,
  ) {}

  async register(_ownerId: string, _raw: unknown) {
    return { created: false, value: {} as Record<string, unknown> };
  }

  async list(_ownerId: string) {
    return [];
  }

  async sync(_ownerId: string, _id: string) {
    return { outcome: 'complete', reason: null, imported: 0, address: {} };
  }

  async transactions(_ownerId: string, _id: string, _raw: unknown) {
    return { total: 0, offset: 0, limit: 50, nextOffset: null, missingUsdValueCount: 0, items: [] };
  }
}
