import type { SwapSummary, SwapTotals } from '@api/asset-swaps.api';
import type { BasisCoverage } from '@api/trades.api';

function Amount({ value, coverage }: { value: string | null; coverage: BasisCoverage }) {
  return (
    <>
      {value ?? 'Неизвестно'}
      {value === null && (
        <small>
          Известная часть: {coverage.knownSubtotalUsd} USD; неизвестных частей:{' '}
          {coverage.unknownCount}.
        </small>
      )}
    </>
  );
}

/** Definition-list entries used for both current and historical evidence. */
export function AssetSwapTotals({ summary }: { summary: SwapTotals | SwapSummary }) {
  return (
    <>
      {'activeCount' in summary && (
        <>
          <dt>Активные обмены</dt>
          <dd>{summary.activeCount}</dd>
        </>
      )}
      <dt>Заявленная оценка обменов, USD</dt>
      <dd>
        <Amount value={summary.considerationUsd} coverage={summary.coverage.consideration} />
      </dd>
      <dt>Себестоимость отданных активов, USD</dt>
      <dd>
        <Amount value={summary.principalBasisUsd} coverage={summary.coverage.principal} />
      </dd>
      <dt>Списанная себестоимость комиссий обменов, USD</dt>
      <dd>
        <Amount value={summary.feeConsumedBasisUsd} coverage={summary.coverage.fee} />
      </dd>
      <dt>Реализованный результат обменов, USD</dt>
      <dd>
        <Amount value={summary.realizedUsd} coverage={summary.coverage.realized} />
      </dd>
    </>
  );
}
