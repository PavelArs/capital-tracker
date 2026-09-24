import type { DisplayFxReport } from '@api/display-fx.api';

export function toDisplayFxView(report: DisplayFxReport) {
  const observation = report.observation;
  return {
    statusText:
      report.status === 'fresh'
        ? 'Сохранённые курсы актуальны'
        : report.status === 'stale'
          ? 'Данные устарели'
          : 'Нет сохранённых курсов',
    rows: observation
      ? [
          { currency: 'EUR', rate: observation.eurRate, amount: observation.eurAmount },
          { currency: 'RUB', rate: observation.rubRate, amount: observation.rubAmount },
        ]
      : [],
    canCollect: report.enabled && !report.collection.inProgress,
  };
}
