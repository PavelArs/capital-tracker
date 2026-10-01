import { lookup } from 'node:dns';
import { Agent } from 'node:https';
import { isIP } from 'node:net';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { type AxiosProxyConfig } from 'axios';
import * as ipaddr from 'ipaddr.js';
import { FxDataError, type FxObservation, parseFxObservation } from './display-fx-domain';

const ENDPOINT = 'https://open.er-api.com/v6/latest/USD';
export type FxFailure = 'provider-error' | 'rate-limited' | 'invalid-data';
export class FxProviderError extends Error {
  constructor(
    readonly outcome: FxFailure,
    readonly retryAfter?: string,
  ) {
    super('Daily display source unavailable');
  }
}

export function isPublicDestination(address: string): boolean {
  return isIP(address) !== 0 && ipaddr.process(address).range() === 'unicast';
}

@Injectable()
export class DisplayFxProvider {
  private readonly agent: Agent;
  private readonly proxy: AxiosProxyConfig | false;

  constructor(config: ConfigService) {
    this.proxy = false;
    if (config.get('DISPLAY_FX_TRUST_PROXY') === 'true') {
      const configured = [
        'HTTPS_PROXY',
        'https_proxy',
        'HTTP_PROXY',
        'http_proxy',
        'ALL_PROXY',
        'all_proxy',
      ]
        .map((key) => config.get<string>(key))
        .find(Boolean);
      try {
        const proxy = new URL(configured ?? '');
        if (
          !['http:', 'https:'].includes(proxy.protocol) ||
          proxy.username ||
          proxy.password ||
          proxy.pathname !== '/' ||
          proxy.search ||
          proxy.hash
        )
          throw new Error();
        this.proxy = {
          protocol: proxy.protocol.slice(0, -1),
          host: proxy.hostname,
          port: Number(proxy.port || (proxy.protocol === 'https:' ? 443 : 80)),
        };
      } catch {
        throw new Error('Invalid trusted FX egress proxy configuration');
      }
    }
    this.agent = new Agent({
      // Validate the addresses used by this connection, never a separate DNS precheck.
      lookup: (hostname, options, callback) => {
        lookup(hostname, { ...options, all: true }, (error, addresses) => {
          if (error) return callback(error, '', 0);
          if (!addresses.length || addresses.some(({ address }) => !isPublicDestination(address))) {
            return callback(new Error('FX destination refused'), '', 0);
          }
          if (options.all) callback(null, addresses);
          else callback(null, addresses[0].address, addresses[0].family);
        });
      },
    });
  }

  async fetch(): Promise<FxObservation> {
    try {
      const response = await axios.get<string>(ENDPOINT, {
        responseType: 'text',
        transformResponse: [(value: string) => value],
        timeout: 5000,
        maxContentLength: 65536,
        maxBodyLength: 0,
        maxRedirects: 0,
        proxy: this.proxy,
        // Trusted proxy mode delegates upstream DNS/TLS transport to that boundary.
        ...(this.proxy === false ? { httpsAgent: this.agent } : {}),
        headers: { Accept: 'application/json' },
        validateStatus: () => true,
      });
      if (response.status === 429) {
        const retryAfter: unknown = response.headers['retry-after'];
        throw new FxProviderError(
          'rate-limited',
          typeof retryAfter === 'string' ? retryAfter : undefined,
        );
      }
      if (response.status !== 200) throw new FxProviderError('provider-error');
      return parseFxObservation(response.data, Date.now());
    } catch (error) {
      if (error instanceof FxProviderError) throw error;
      throw new FxProviderError(error instanceof FxDataError ? 'invalid-data' : 'provider-error');
    }
  }
}
