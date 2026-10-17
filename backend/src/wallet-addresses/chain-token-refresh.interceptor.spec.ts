import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { defer, firstValueFrom, of } from 'rxjs';
import type { DataSource } from 'typeorm';
import { chainAsset, forgetTokens } from './chain-assets';
import { ChainTokenRefreshInterceptor } from './chain-token-refresh.interceptor';

// Synthetic contract and token row, as chain_tokens stores them (TOKEN-ANY).
const contract = `0x${'7f3a'.repeat(10)}`;
const row = {
  network: 'ethereum',
  contract,
  symbol: 'SYN',
  name: 'Synthetic',
  decimals: 18,
  ticker: 'SYN',
  coingeckoId: null,
};

function setup(method: string) {
  const query = jest.fn(async () => [row]);
  const interceptor = new ChainTokenRefreshInterceptor({
    manager: { query },
  } as unknown as DataSource);
  const context = {
    switchToHttp: () => ({ getRequest: () => ({ method }) }),
  } as unknown as ExecutionContext;
  const runs = { count: 0 };
  // The real registry lookup, as every wallet, operation and portfolio read does it.
  const next: CallHandler = {
    handle: () =>
      defer(() => {
        runs.count += 1;
        return of(chainAsset('ethereum', contract).symbol);
      }),
  };
  return { query, runs, run: () => firstValueFrom(interceptor.intercept(context, next)) };
}

describe('TOKEN-ANY-REFRESH: a token another backend process stored', () => {
  beforeEach(() => forgetTokens());
  afterEach(() => forgetTokens());

  it('reloads chain_tokens once and runs a read again instead of failing it', async () => {
    const { query, runs, run } = setup('GET');
    await expect(run()).resolves.toBe('SYN');
    expect([query.mock.calls.length, runs.count]).toEqual([1, 2]);
  });

  it('reloads for a write but keeps its error, so the write is never run twice', async () => {
    const { query, runs, run } = setup('POST');
    await expect(run()).rejects.toThrow('Unknown chain asset');
    expect([query.mock.calls.length, runs.count]).toEqual([1, 1]);
  });

  it('fails a read again when the table does not know the token either', async () => {
    const { query, run } = setup('GET');
    query.mockResolvedValue([] as never);
    await expect(run()).rejects.toThrow('Unknown chain asset');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('leaves every other error alone', async () => {
    const { query } = setup('GET');
    const interceptor = new ChainTokenRefreshInterceptor({
      manager: { query },
    } as unknown as DataSource);
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ method: 'GET' }) }),
    } as unknown as ExecutionContext;
    const failing: CallHandler = { handle: () => defer(() => Promise.reject(new Error('boom'))) };
    await expect(firstValueFrom(interceptor.intercept(context, failing))).rejects.toThrow('boom');
    expect(query).not.toHaveBeenCalled();
  });
});
