import type { RewardReceipt } from '@api/asset-rewards.api';

export function AssetRewardReceipt({ receipt }: { receipt: RewardReceipt }) {
  return (
    <section className="manual-card" aria-label="Квитанция вознаграждения">
      <h3>Квитанция команды</h3>
      <p>Квитанция неизменна и не описывает текущую себестоимость после последующих исправлений.</p>
      <dl className="trade-summary">
        <dt>Номер вознаграждения</dt>
        <dd>{receipt.reward.rewardId}</dd>
        <dt>Версия</dt>
        <dd>{receipt.reward.version}</dd>
        <dt>Ревизия журнала</dt>
        <dd>{receipt.journalRevision}</dd>
      </dl>
    </section>
  );
}
