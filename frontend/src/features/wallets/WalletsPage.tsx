import type { WalletAddress } from '@api/wallet-addresses.api';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { withCurrency } from '../portfolio/currency';
import { money } from '../portfolio/format';
import { Icon } from '../shell/icons';
import PageHeader from '../shell/PageHeader';
import { useNarrowScreen } from '../transactions/useNarrowScreen';
import AddressDrawer from './AddressDrawer';
import AddWalletDialog, { type WalletAccount } from './AddWalletDialog';
import { useWallets } from './useWallets';
import {
  AddressRow,
  holdingsOf,
  ManualRow,
  ReconcileNote,
  subtitle,
  trackedSymbols,
} from './WalletParts';
import { isCoin, pricesOf, reconcile } from './wallets';
import '../shell/shell-page.css';
import '../portfolio/portfolio.css';
import '../transactions/transactions.css';
import './wallets.css';

// Wallets grouped the way the owner holds them (prototype "Wallets", M10): each account with
// its tracked addresses, the coins entered by hand, and whether the chain agrees.
export default function WalletsPage() {
  const { portfolio, addresses, failed, load, replace, runs, sync, asked } = useWallets();
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const narrow = useNarrowScreen();
  const accounts: WalletAccount[] = (portfolio?.accounts ?? []).map(({ accountId, name }) => ({
    accountId,
    name,
  }));
  const list = addresses ?? [];
  const currency = portfolio?.currency ?? 'USD';
  const prices = pricesOf(portfolio);
  const open = list.find((address) => address.id === openId);
  const unassigned = list.filter(
    (address) => !address.accountId || !accounts.some((a) => a.accountId === address.accountId),
  );
  const cards = portfolio
    ? portfolio.accounts
        .map((account) => ({
          account,
          addresses: list.filter((address) => address.accountId === account.accountId),
          holdings: holdingsOf(portfolio, account.accountId),
        }))
        // Wallets with addresses first, then by value, then by name.
        .sort(
          (left, right) =>
            Number(right.addresses.length > 0) - Number(left.addresses.length > 0) ||
            Number(right.account.pricedValue ?? 0) - Number(left.account.pricedValue ?? 0) ||
            left.account.name.localeCompare(right.account.name, 'en'),
        )
    : [];

  const addButton = (
    <button
      type="button"
      className="shell-button shell-button--primary"
      onClick={() => setAdding(true)}
    >
      <Icon name="plus" className="shell-icon shell-icon--sm" />
      Add wallet
    </button>
  );
  const rows = (items: WalletAddress[]) =>
    items.map((address) => (
      <AddressRow
        key={address.id}
        address={address}
        run={runs[address.id]}
        narrow={narrow}
        prices={prices}
        currency={currency}
        onOpen={() => setOpenId(address.id)}
        onSync={() => void sync(address.id)}
      />
    ));

  return (
    <div className="shell-page">
      <PageHeader
        title="Wallets"
        currency={portfolio?.currency}
        onTransactionSaved={() => void load(true)}
      />
      {failed ? (
        <section className="shell-card portfolio-state" role="alert">
          <p>Could not load your wallets. Your data is safe; try again.</p>
          <button type="button" className="shell-button" onClick={() => void load()}>
            Try again
          </button>
        </section>
      ) : portfolio === null || addresses === null ? (
        <section className="shell-card portfolio-state" role="status">
          Loading wallets…
        </section>
      ) : cards.length === 0 && list.length === 0 ? (
        <section className="shell-card shell-empty" aria-labelledby="wallets-empty">
          <span className="shell-empty__ill" aria-hidden="true">
            <Icon name="wallets" />
          </span>
          <h2 id="wallets-empty">No wallets connected</h2>
          <p>
            Add a Bitcoin, Ethereum or Solana address. The app only reads public data and never asks
            for a seed phrase.
          </p>
          {addButton}
        </section>
      ) : (
        <>
          <div className="wallets-intro">
            <p className="wallets-soft">
              Wallets are read-only. The app stores only public addresses and read-only exchange
              keys; it never asks for a seed phrase or a private key.
            </p>
            {addButton}
          </div>
          {unassigned.length > 0 && (
            <section className="shell-card wallets-card" aria-labelledby="wallets-unassigned">
              <div className="wallets-card__head">
                <span className="wallets-card__icon" aria-hidden="true">
                  <Icon name="wallets" />
                </span>
                <div className="wallets-card__title">
                  <h2 id="wallets-unassigned">Not in a wallet yet</h2>
                  <span>Open an address and choose the wallet it belongs to.</span>
                </div>
              </div>
              <ul className="wallets-sources">{rows(unassigned)}</ul>
            </section>
          )}
          {cards.map(({ account, addresses: own, holdings }) => {
            const tracked = trackedSymbols(own);
            const manual = holdings.filter(
              (holding) => ![...tracked].some((symbol) => isCoin(holding.asset, symbol)),
            );
            const headingId = `wallet-${account.accountId}`;
            return (
              <section
                key={account.accountId}
                className="shell-card wallets-card"
                aria-labelledby={headingId}
              >
                <div className="wallets-card__head">
                  <span className="wallets-card__icon" aria-hidden="true">
                    <Icon name="wallets" />
                  </span>
                  <div className="wallets-card__title">
                    <h2 id={headingId}>
                      <Link
                        className="wallets-card__link"
                        to={withCurrency(`/wallets/${account.accountId}`, asked)}
                      >
                        {account.name}
                      </Link>
                    </h2>
                    <span>{subtitle(own)}</span>
                  </div>
                  <div className="wallets-card__total">
                    <strong>{money(account.pricedValue, currency)}</strong>
                    <span>{holdings.length === 1 ? '1 asset' : `${holdings.length} assets`}</span>
                  </div>
                </div>
                {own.length > 0 || manual.length > 0 ? (
                  <ul className="wallets-sources">
                    {rows(own)}
                    {manual.length > 0 && (
                      <ManualRow holdings={manual} currency={currency} narrow={narrow} />
                    )}
                  </ul>
                ) : (
                  <p className="wallets-empty-row">Nothing in this wallet yet.</p>
                )}
                <ReconcileNote result={reconcile(list, portfolio, account.accountId)} />
              </section>
            );
          })}
        </>
      )}
      {adding && (
        <AddWalletDialog
          accounts={accounts}
          addresses={list}
          onClose={() => setAdding(false)}
          onOpenExisting={(address) => {
            setAdding(false);
            setOpenId(address.id);
          }}
          onAdded={(address, created) => {
            setAdding(false);
            replace(address);
            void load(true);
            if (created) void sync(address.id);
            else setOpenId(address.id);
            // A Bybit account added again carries a new key: read it at once.
            if (!created && address.network === 'bybit') void sync(address.id);
          }}
        />
      )}
      {open && portfolio && (
        <AddressDrawer
          key={open.id}
          address={open}
          accounts={accounts}
          currency={currency}
          prices={prices}
          run={runs[open.id]}
          onSync={() => void sync(open.id)}
          onSaved={(address, newAccount) => {
            replace(address);
            if (newAccount) void load(true);
          }}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}
