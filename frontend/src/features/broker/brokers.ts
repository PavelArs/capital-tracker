import type { AccountSummary } from '@api/accounting.api';
import type { AssetValuation, PortfolioValuation } from '@api/portfolio-valuation.api';
import { sumDecimals } from '@/utils/decimal';

export interface BrokerPosition {
  asset: AssetValuation;
  /** What this account holds of the asset. */
  quantity: string;
  value: string | null;
}

export interface BrokerAccount {
  id: string;
  name: string;
  /** BROKER-SETUP: read with a T-Bank token. */
  connected: boolean;
  /** Read with a token, no history imported yet and nothing held: positions arrive with it. */
  pending: boolean;
  /** Something in it has a value; otherwise its total is shown as "—", never as zero. */
  valued: boolean;
  /** Securities first, most valuable first, then the cash. */
  positions: BrokerPosition[];
  /** What the priced positions are worth, exactly. */
  value: string;
  /** Positions without a price, left out of the value. */
  unpriced: number;
  /** Positions with a price but no exchange rate to the shown currency, left out too. */
  unrated: number;
}

const unrated = (position: BrokerPosition) => position.asset.missingPrice === 'no-rate';

const byValue = (left: BrokerPosition, right: BrokerPosition) =>
  Number(right.value ?? 0) - Number(left.value ?? 0) ||
  left.asset.name.localeCompare(right.asset.name, 'en');

/** The owner's broker accounts (v8) with what each holds, most valuable first. */
export function brokerAccountsOf(
  portfolio: PortfolioValuation,
  accounts: readonly AccountSummary[],
): BrokerAccount[] {
  return accounts
    .filter((account) => account.assetClass === 'broker')
    .map((account) => {
      const positions = portfolio.assets.flatMap((asset) =>
        asset.holdings
          .filter((holding) => holding.accountId === account.id && Number(holding.quantity) > 0)
          .map((holding) => ({ asset, quantity: holding.quantity, value: holding.value })),
      );
      const cash = (position: BrokerPosition) => position.asset.assetType === 'fiat';
      const connected = account.connection?.provider === 'tbank';
      // Waiting only while no history import was written and nothing is held.
      const pending = connected && !account.connection?.imported && positions.length === 0;
      return {
        id: account.id,
        name: account.name,
        connected,
        pending,
        valued: positions.length === 0 ? !pending : positions.some(({ value }) => value !== null),
        positions: [
          ...positions.filter((position) => !cash(position)).sort(byValue),
          ...positions.filter(cash).sort(byValue),
        ],
        value: sumDecimals(positions.flatMap(({ value }) => (value === null ? [] : [value]))),
        unpriced: positions.filter((position) => position.value === null && !unrated(position))
          .length,
        unrated: positions.filter((position) => position.value === null && unrated(position))
          .length,
      };
    })
    .sort(
      (left, right) =>
        Number(right.value) - Number(left.value) || left.name.localeCompare(right.name, 'en'),
    );
}

/** The share of net worth held at brokers, or null while the net worth is unknown. */
export function brokerShare(total: string, portfolio: PortfolioValuation): number | null {
  const worth = Number(portfolio.totalValue ?? Number.NaN);
  return worth > 0 ? (Number(total) / worth) * 100 : null;
}

/** "1 position", "2 positions". */
export const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`;

/** What a total at brokers leaves out: positions without a price, then without a rate. */
export function leftOut(unpriced: number, unrated: number): string | null {
  const parts = [
    unpriced > 0 && `${plural(unpriced, 'position')} without a price left out.`,
    unrated > 0 && `${plural(unrated, 'position')} without an exchange rate left out.`,
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

/** One broker with its accounts: every T-Bank account read with a token, or one typed name. */
export interface BrokerGroup {
  key: string;
  name: string;
  accounts: BrokerAccount[];
  /** How many of its accounts read with a token. */
  connected: number;
  /** What the valued accounts hold, exactly; shown only when `valued`. */
  value: string;
  valued: boolean;
  unpriced: number;
  unrated: number;
  /** Accounts still waiting for the history import, left out of the value. */
  pending: number;
}

const TBANK = 'T-Bank';
const IIS = / · IIS$/;
/** The broker a hand-entered account was added under: its name without " · IIS". */
const typedBroker = (account: BrokerAccount) => account.name.replace(IIS, '').trim();
/** An account read under its typed broker's card as that broker's IIS. */
const isIisOf = (account: BrokerAccount, key: string) =>
  !account.connected && IIS.test(account.name) && typedBroker(account).toLowerCase() === key;

/**
 * The account's name inside its broker's card (`key`): "IIS" for a hand-entered "<broker> · IIS"
 * in <broker>'s card, and a T-Bank account without the "T-Bank " its default name starts with.
 */
export function accountLabel(account: BrokerAccount, key: string): string {
  if (account.connected) {
    const rest = account.name.startsWith(`${TBANK} `)
      ? account.name.slice(TBANK.length).trim()
      : '';
    return rest || account.name;
  }
  return isIisOf(account, key) ? 'IIS' : account.name;
}

/**
 * BROKERS-GROUP: one group per broker, most valuable first. Accounts read with a T-Bank token
 * group under T-Bank whatever their names; the rest by the broker name typed, ignoring case.
 */
export function brokerGroupsOf(accounts: readonly BrokerAccount[]): BrokerGroup[] {
  // Only the name records an IIS, and a regular account may be typed "<broker> · IIS" too: such a
  // name joins <broker> only when a regular account is named <broker>, and otherwise keeps its own.
  const regular = new Set(
    accounts
      .filter((account) => !account.connected && !IIS.test(account.name))
      .map((account) => account.name.trim().toLowerCase()),
  );
  const groupKey = (account: BrokerAccount) => {
    if (account.connected) return TBANK.toLowerCase();
    const broker = typedBroker(account).toLowerCase();
    return regular.has(broker) ? broker : account.name.trim().toLowerCase();
  };
  const groups = new Map<string, BrokerAccount[]>();
  for (const account of accounts) {
    const key = groupKey(account);
    groups.set(key, [...(groups.get(key) ?? []), account]);
  }
  return [...groups.entries()]
    .map(([key, members]): BrokerGroup => {
      const typed = members.find((account) => !account.connected && !IIS.test(account.name));
      const valued = members.filter((account) => account.valued);
      return {
        key,
        name: members.some((account) => account.connected)
          ? TBANK
          : (typed ?? members[0]).name.trim(),
        accounts: members,
        connected: members.filter((account) => account.connected).length,
        value: sumDecimals(valued.map((account) => account.value)),
        valued: valued.length > 0,
        unpriced: members.reduce((sum, account) => sum + account.unpriced, 0),
        unrated: members.reduce((sum, account) => sum + account.unrated, 0),
        pending: members.filter((account) => account.pending).length,
      };
    })
    .sort(
      (left, right) =>
        Number(right.valued) - Number(left.valued) ||
        Number(right.value) - Number(left.value) ||
        left.name.localeCompare(right.name, 'en'),
    );
}

/** What a total at brokers leaves out, including accounts whose history is not imported yet. */
export function brokerGaps(unpriced: number, unrated: number, pending: number): string | null {
  const parts = [
    leftOut(unpriced, unrated),
    pending > 0 && `${plural(pending, 'account')} waiting for the history import.`,
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}
