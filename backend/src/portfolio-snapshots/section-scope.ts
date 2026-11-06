import type { ValuationInputs } from '../accounting/portfolio-valuation.service';

/**
 * SECTION-CHART: the parts of the capital the dashboard chart can show alone, named as the
 * navigation names them. A wallet is an account with no class, `bank` is the deposits, and a
 * broker or property account has the class of its name.
 */
export const historySections = ['wallet', 'bank', 'broker', 'property'] as const;
export type HistorySection = (typeof historySections)[number];

/**
 * The inputs of one section: only its accounts (a wallet's class is null) or, for the banks,
 * only the deposits. Valuation, history and flows read these as they read the whole.
 * `transfersAcross` counts the own transfers with one end outside the section: they move value
 * in or out with no money put in, which the section's figures cannot tell apart from a gain.
 */
export function scopeToSection(
  inputs: ValuationInputs,
  section: HistorySection,
): { inputs: ValuationInputs; accountIds: ReadonlySet<string>; transfersAcross: number } {
  const accounts =
    section === 'bank'
      ? []
      : inputs.accounts.filter((row) => (row.assetClass ?? 'wallet') === section);
  const accountIds = new Set(accounts.map((row) => row.accountId));
  const across = new Set<string>();
  for (const ledger of new Set(inputs.ledgers.values()))
    for (const transfer of ledger.transfers)
      if (accountIds.has(transfer.fromAccountId) !== accountIds.has(transfer.toAccountId))
        across.add(transfer.transferId);
  return {
    inputs: { ...inputs, accounts, deposits: section === 'bank' ? inputs.deposits : [] },
    accountIds,
    transfersAcross: section === 'bank' ? 0 : across.size,
  };
}
