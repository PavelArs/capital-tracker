import { accountingApi } from '@api/accounting.api';
import { fxRatesApi } from '@api/fx-rates.api';
import { portfolioAssetsApi } from '@api/portfolio-assets.api';
import { portfolioValuationApi } from '@api/portfolio-valuation.api';
import { tradesApi } from '@api/trades.api';
import './index.css';
import '@features/shell/tokens.css';
import '@features/shell/shell-page.css';
import '@features/portfolio/portfolio.css';
import PortfolioPage from '@features/portfolio/PortfolioPage';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

// Synthetic data for screenshots only.
const theme = new URLSearchParams(location.search).get('theme') ?? 'dark';
document.documentElement.setAttribute('data-theme', theme);
document.body.style.margin = '0';
document.body.style.background = 'var(--bg)';
document.body.style.color = 'var(--ink)';
document.body.style.fontFamily = 'var(--font-ui)';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const asset = (n: number, name: string, symbol: string) => ({ id: id(n), name, symbol, namespace: 'manual' as const, assetType: 'crypto' as const, valuationCurrency: 'USD' as const, priceSource: 'market' as const, createdAt: '2025-01-01T00:00:00.000Z' });
const assets = [asset(1, 'Bitcoin', 'BTC'), asset(2, 'Ether', 'ETH'), asset(3, 'Solana', 'SOL'), asset(4, 'Tether', 'USDT')];
portfolioAssetsApi.listAll = async () => assets;
accountingApi.listAccounts = async () => ({ items: [
  { id: id(11), name: 'Hardware wallet', currentRevision: 0, createdAt: '2025-01-01T00:00:00.000Z' },
  { id: id(12), name: 'Exchange', currentRevision: 0, createdAt: '2025-01-01T00:00:00.000Z' }], nextCursor: null });
tradesApi.state = async (accountId) => ({ accountId, eligible: false, ineligibilityReason: 'already-initialized', journal: { journalRevision: 3 } }) as never;
fxRatesApi.get = async (date) => ({ date: date ?? '', source: 'cbr', rates: [
  { currency: 'USD', rubPerUnit: '78.5', date: date ?? null }, { currency: 'EUR', rubPerUnit: '90', date: date ?? null }], sync: null });
const row = (n: number, name: string, symbol: string, quantity: string, price: string, value: string, cost: string, pnl: string, pct: string, alloc: string) => ({
  instrumentId: id(n), name, symbol, assetType: 'crypto', valuationCurrency: 'USD', priceSource: 'market', quantity,
  price: { value: price, observedAt: new Date().toISOString(), source: 'kraken', status: 'fresh' }, missingPrice: null, value, allocationPercent: alloc,
  costBasis: cost, knownCostSubtotal: cost, unknownCostCount: 0, averageBuyPrice: String(Number(cost) / Number(quantity)), unrealizedPnl: pnl, unrealizedReturnPercent: pct,
  realizedPnl: '0', knownRealizedSubtotal: '0', unknownRealizedCount: 0, missingRateCount: 0, accounts: [] });
portfolioValuationApi.get = async () => ({
  at: new Date().toISOString(), currency: 'USD', mainCurrency: 'USD', rates: [], completeness: 'complete', totalValue: '15250', pricedSubtotal: '15250',
  missingPriceCount: 0, stalePriceCount: 0, unavailableAccountCount: 0, costBasis: '12000', knownCostSubtotal: '12000', unknownCostCount: 0, missingRateCount: 0,
  unrealizedPnl: '3250', unrealizedReturnPercent: '27.08', realizedPnl: '0', knownRealizedSubtotal: '0', unknownRealizedCount: 0,
  assets: [row(1, 'Bitcoin', 'BTC', '0.1', '100000', '10000', '8000', '2000', '25.00', '65.57'), row(2, 'Ether', 'ETH', '1.5', '3500', '5250', '4000', '1250', '31.25', '34.43')],
  allocation: { complete: true, byAsset: [], byType: [], byAccount: [] },
}) as never;
createRoot(document.getElementById('root')!).render(<MemoryRouter><div style={{ padding: '24px 32px' }}><PortfolioPage /></div></MemoryRouter>);
