import {
  type HiddenReason,
  type WalletAddress,
  walletAddressesApi,
} from '@api/wallet-addresses.api';
import { useState } from 'react';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { quantity } from '../portfolio/format';
import LoadMore, { useInfinite } from '../shell/InfiniteScroll';

// TOKEN-HIDE: the other tokens of an Ethereum or Solana address. Anyone can send a wallet any
// token, so most of them are spam: the owner hides the ones they do not want, and a token that
// cannot be real is hidden by itself. Hidden tokens stay out of the balance, its value and the
// "Balance differs" check, and come back with Restore.

const reasons: Record<HiddenReason, string> = {
  negative:
    'Hidden by the app: the history sends out more than it received, which forged transfers do',
  lookalike: 'Hidden by the app: it calls itself like a coin you track but is a different token',
  dust: 'Hidden by the app: worth less than your dust threshold, or no price source lists it',
  owner: 'Hidden by you',
};

export default function TokensSection({
  address,
  onChange,
}: {
  address: WalletAddress;
  onChange: (address: WalletAddress) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // Most hidden tokens are spam nobody needs to read, so the list opens on request.
  const [listed, setListed] = useState(false);
  const shown = (address.balances ?? []).filter((balance) => balance.name !== undefined);
  const hidden = address.hiddenTokens ?? [];
  // PAGES: twenty tokens a page in each list.
  const shownPages = useInfinite(shown);
  const hiddenPages = useInfinite(hidden);
  if (shown.length === 0 && hidden.length === 0) return null;
  const unlisted = shown.filter((balance) => balance.listed === false);

  const change = async (tickers: string[], visibility: 'hidden' | 'shown') => {
    setBusy(true);
    setFailed(false);
    try {
      onChange(await walletAddressesApi.tokens(address.id, tickers, visibility));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {shown.length > 0 && (
        <section aria-labelledby="address-tokens">
          <h3 id="address-tokens" className="ui-section-t">
            Other tokens
          </h3>
          <ul className="wallets-list wallets-tokens">
            {shownPages.rows.map((balance) => (
              <li key={balance.symbol}>
                <span className="wallets-tokens__name">
                  <span>{balance.symbol}</span>
                  <span className="ui-muted wallets-small">
                    {balance.name}
                    {balance.listed === false && ' · no price'}
                  </span>
                </span>
                <span className="ui-num ui-nowrap">{quantity(balance.quantity)}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Hide ${balance.symbol}`}
                  disabled={busy}
                  onClick={() => void change([balance.symbol], 'hidden')}
                >
                  Hide
                </Button>
              </li>
            ))}
          </ul>
          {shownPages.more && <LoadMore {...shownPages.more} label="tokens" />}
          {unlisted.length > 1 && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void change(
                  unlisted.map((balance) => balance.symbol),
                  'hidden',
                )
              }
            >
              Hide {unlisted.length} tokens no price source lists
            </Button>
          )}
          <p className="ui-muted wallets-stake__note">
            Anyone can send a wallet a token, and most unpriced ones are spam. A hidden token stays
            out of this balance, its value and the balance check; the transactions stay in the list.
          </p>
        </section>
      )}
      {hidden.length > 0 && (
        <section aria-labelledby="address-hidden-tokens">
          <h3 id="address-hidden-tokens" className="ui-section-t">
            Hidden tokens ({hidden.length})
          </h3>
          {listed && (
            <ul className="wallets-list wallets-tokens">
              {hiddenPages.rows.map((token) => (
                <li key={token.symbol}>
                  <span className="wallets-tokens__name">
                    <span>{token.symbol}</span>
                    <span className="ui-muted wallets-small">{reasons[token.reason]}</span>
                  </span>
                  <span className="ui-num ui-nowrap">{quantity(token.quantity)}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Restore ${token.symbol}`}
                    disabled={busy}
                    onClick={() => void change([token.symbol], 'shown')}
                  >
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {listed && hiddenPages.more && <LoadMore {...hiddenPages.more} label="hidden tokens" />}
          <Button
            variant="link"
            aria-expanded={listed}
            onClick={() => setListed((current) => !current)}
          >
            {listed ? 'Show less' : 'Show more'}
          </Button>
        </section>
      )}
      {failed && <Banner tone="neg">Could not change the tokens. Try again.</Banner>}
    </>
  );
}
