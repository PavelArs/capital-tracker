import type { StepFailure } from './chain-sync';
import type {
  BlockResult,
  CallResult,
  EtherscanClient,
  InternalTransfer,
  ListResult,
  NormalTransaction,
  TokenTransfer,
} from './etherscan-client';

// How long a chain stays on its fallback source after Etherscan turned it away; then Etherscan
// is asked again, in case the plan changed.
export const FALLBACK_FOR_MS = 6 * 60 * 60_000;

type Answer = { ok: true } | { ok: false; reason: StepFailure };

/**
 * BLOCKSCOUT: reads one chain's history from Etherscan and, when Etherscan's free plan does not
 * serve that chain, from the chain's own Blockscout explorer. Both answer the same questions in
 * the same shape, so a pass may start on one and continue on the other without gaps.
 */
export class EvmReader {
  private fallbackSince: number | null = null;

  constructor(
    private readonly primary: EtherscanClient,
    private readonly fallback: EtherscanClient | null,
    private readonly now: () => number = Date.now,
  ) {}

  get configured(): boolean {
    return this.primary.configured;
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

  private async read<T extends Answer>(ask: (client: EtherscanClient) => Promise<T>): Promise<T> {
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
