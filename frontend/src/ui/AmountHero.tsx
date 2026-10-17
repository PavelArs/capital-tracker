import type { ReactNode } from 'react';
import './key-value.css';

/**
 * The top of a drawer: a badge (Blockchain · Buy, Needs classification), the signed amount at
 * 28 px and its value or cost under it. The amount is shown as the caller formatted it.
 */
export function AmountHero({
  badge,
  amount,
  detail,
}: {
  badge?: ReactNode;
  amount: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="ui-amt-hero">
      {badge}
      <p className="ui-amt-hero__amount">{amount}</p>
      {detail && <p className="ui-amt-hero__detail">{detail}</p>}
    </div>
  );
}
