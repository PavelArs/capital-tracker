import type { ConnectedLedger } from '../accounting/connected-accounting.store';
import type { ValuationInputs } from '../accounting/portfolio-valuation.service';
import type { DepositHolding } from '../deposits/deposit-valuation';
import { historySections, scopeToSection } from './section-scope';

const account = (accountId: string, assetClass: 'broker' | 'property' | null = null) => ({
  accountId,
  name: accountId,
  assetClass,
  coverageFrom: new Date('2025-06-01T00:00:00.000Z'),
});

// One ledger joins the wallet and the broker account by an own transfer; the property account
// has a ledger of its own.
function inputs(): ValuationInputs {
  const linked = {
    accounts: new Map([
      ['wallet', {}],
      ['broker', {}],
    ]),
    transfers: [
      { transferId: 't1', fromAccountId: 'wallet', toAccountId: 'broker' },
      { transferId: 't2', fromAccountId: 'wallet', toAccountId: 'wallet-2' },
    ],
  } as unknown as ConnectedLedger;
  const alone = { accounts: new Map([['house', {}]]), transfers: [] } as unknown as ConnectedLedger;
  return {
    instruments: [],
    hidden: new Set(),
    accounts: [
      account('wallet'),
      account('wallet-2'),
      account('broker', 'broker'),
      account('house', 'property'),
    ],
    ledgers: new Map([
      ['wallet', linked],
      ['wallet-2', linked],
      ['broker', linked],
      ['house', alone],
    ]),
    chainMoves: new Map(),
    deposits: [{ deposit: { id: 'd1' } } as unknown as DepositHolding],
  };
}

describe('SECTION-CHART scopeToSection', () => {
  it('names the four sections of the dashboard chart', () => {
    expect(historySections).toEqual(['wallet', 'bank', 'broker', 'property']);
  });

  it('keeps the wallets, whose class is null, and no deposit', () => {
    const scoped = scopeToSection(inputs(), 'wallet');
    expect(scoped.inputs.accounts.map((row) => row.accountId)).toEqual(['wallet', 'wallet-2']);
    expect(scoped.inputs.deposits).toEqual([]);
    expect([...scoped.accountIds]).toEqual(['wallet', 'wallet-2']);
  });

  it('keeps the broker accounts alone, and the property accounts alone', () => {
    expect(scopeToSection(inputs(), 'broker').inputs.accounts.map((row) => row.accountId)).toEqual([
      'broker',
    ]);
    expect(
      scopeToSection(inputs(), 'property').inputs.accounts.map((row) => row.accountId),
    ).toEqual(['house']);
  });

  it('keeps the deposits and no account for the banks', () => {
    const scoped = scopeToSection(inputs(), 'bank');
    expect(scoped.inputs.accounts).toEqual([]);
    expect(scoped.inputs.deposits).toHaveLength(1);
    expect(scoped.accountIds.size).toBe(0);
    expect(scoped.transfersAcross).toBe(0);
  });

  it('counts a transfer with one end outside the section, once, from either side', () => {
    // t1 leaves the wallets for the broker; t2 stays among wallets (wallet-2 is one).
    expect(scopeToSection(inputs(), 'wallet').transfersAcross).toBe(1);
    expect(scopeToSection(inputs(), 'broker').transfersAcross).toBe(1);
    expect(scopeToSection(inputs(), 'property').transfersAcross).toBe(0);
  });

  it('leaves everything else of the inputs as it is', () => {
    const whole = inputs();
    const scoped = scopeToSection(whole, 'broker').inputs;
    expect(scoped.ledgers).toBe(whole.ledgers);
    expect(scoped.hidden).toBe(whole.hidden);
    expect(scoped.instruments).toBe(whole.instruments);
  });
});
