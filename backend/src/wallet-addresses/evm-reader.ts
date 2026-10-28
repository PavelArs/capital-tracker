import type {
  BlockResult,
  CallResult,
  EtherscanClient,
  Failed,
  InternalTransfer,
  ListResult,
  NormalTransaction,
  TokenTransfer,
} from './etherscan-client';

// How long a chain stays on its fallback source after Etherscan turned it away; then Etherscan
// is asked again, in case the plan changed.
export const FALLBACK_FOR_MS = 6 * 60 * 60_000;

type Answer = { ok: true } | Failed;
export type EvmSource = 'primary' | 'fallback';

/**
 * BLOCKSCOUT: reads one chain's history from Etherscan and, when Etherscan's free plan does not
 * serve that chain, from the chain's own Blockscout explorer. Both answer the same questions in
 * the same shape, so a pass may start on one and continue on the other without gaps.
 */
export class EvmReader {
  private fallbackSince: number | null = null;
  // SYNC-DETAIL: what the source last said when it refused, until a read succeeds.
  private said: string | null = null;

  constructor(
    private readonly primary: EtherscanClient,
    private readonly fallback: EtherscanClient | null,
    private readonly now: () => number = Date.now,
  ) {}

  get configured(): boolean {
    return this.primary.configured;
  }

  /** What the source said about the last refusal, for the wallet's message; null if it said nothing. */
  get detail(): string | null {
    return this.said;
  }

  blockNumber(): Promise<BlockResult> {
    return this.read((client) => client.blockNumber());
  }

  call(to: string, data: string, block: number): Promise<CallResult> {
    return this.read((client) => client.call(to, data, block));
  }

  normal(address: string, from: number, to: number): Promise<ListResult<NormalTransaction>> {
    return this.read((client) => client.normal(address, from, to));
  }

  internal(address: string, from: number, to: number): Promise<ListResult<InternalTransfer>> {
    return this.read((client) => client.internal(address, from, to));
  }

  tokens(address: string, from: number, to: number): Promise<ListResult<TokenTransfer>> {
    return this.read((client) => client.tokens(address, from, to));
  }

  get fallbackAvailable(): boolean {
    return this.fallback !== null;
  }

  get historySource(): EvmSource {
    return this.fallback !== null &&
      this.fallbackSince !== null &&
      this.now() - this.fallbackSince < FALLBACK_FOR_MS
      ? 'fallback'
      : 'primary';
  }

  /** An unfinished block keeps one provider, even across the fallback expiry. */
  async page(
    source: EvmSource,
    kind: 'normal' | 'internal' | 'tokens',
    address: string,
    block: number,
    page: number,
  ) {
    const client = source === 'primary' ? this.primary : this.fallback;
    const answer =
      client === null
        ? { ok: false as const, reason: 'unavailable' as const }
        : await client[kind](address, block, block, page);
    this.said = answer.ok ? null : (answer.detail ?? null);
    return answer;
  }

  private async read<T extends Answer>(ask: (client: EtherscanClient) => Promise<T>): Promise<T> {
    const answer = await this.route(ask);
    this.said = answer.ok ? null : (answer.detail ?? null);
    return answer;
  }

  private async route<T extends Answer>(ask: (client: EtherscanClient) => Promise<T>): Promise<T> {
    const fallback = this.fallback;
    if (fallback === null) return ask(this.primary);
    if (this.fallbackSince !== null && this.now() - this.fallbackSince < FALLBACK_FOR_MS) {
      return ask(fallback);
    }
    this.fallbackSince = null;
    const answer = await ask(this.primary);
    if (answer.ok || answer.reason !== 'plan_required') return answer;
    this.fallbackSince = this.now();
    return ask(fallback);
  }
}
