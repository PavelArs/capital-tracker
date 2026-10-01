import type { ManualPortfolioValuationResponse } from '@api/manual-portfolio-valuation.api';

const unknownTotal = 'Не определена';
const unknownCount = 'Не определено';

export function toManualPortfolioView(report: ManualPortfolioValuationResponse) {
  return {
    statusText:
      report.completeness === 'complete'
        ? 'Полная оценка выбранных счетов'
        : 'Неполная оценка выбранных счетов',
    totalText: report.totalValueUsd ?? unknownTotal,
    subtotalText: report.pricedSubtotalUsd,
    rows: report.accounts.map((account) => ({
      accountId: account.accountId,
      name: account.name,
      coverageText:
        account.coverage === 'covered'
          ? 'История доступна'
          : account.coverage === 'missing-journal'
            ? 'История не инициализирована'
            : 'Момент раньше начала истории',
      coverageFrom: account.coverageFrom,
      journalRevision: account.journalRevision,
      completenessText: account.completeness === 'complete' ? 'Полная' : 'Неполная',
      missingPriceText:
        account.missingPriceCount === null ? unknownCount : String(account.missingPriceCount),
      subtotalText: account.pricedSubtotalUsd ?? unknownTotal,
      totalText: account.totalValueUsd ?? unknownTotal,
    })),
  };
}
