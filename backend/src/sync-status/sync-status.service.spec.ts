import { walletSourceName } from './sync-status.service';

describe('sync status wallet names (SYNC-STATUS)', () => {
  it('names an unlabelled wallet by its network and keeps the owner label', () => {
    expect(walletSourceName({ network: 'bitcoin', label: null })).toBe('Bitcoin');
    expect(walletSourceName({ network: 'ethereum', label: null })).toBe('Ethereum');
    expect(walletSourceName({ network: 'solana', label: null })).toBe('Solana');
    expect(walletSourceName({ network: 'ethereum', label: 'Cold ETH' })).toBe('Cold ETH');
  });
});
