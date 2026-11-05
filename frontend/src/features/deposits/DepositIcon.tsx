import type { Deposit } from '@api/deposits.api';
import { depositIdentity } from '../shell/asset-identity';
import '../shell/asset-icon.css';

/** The round coloured glyph of a bank product, the one it has on every screen; decorative. */
export default function DepositIcon({
  deposit,
  size = 'md',
}: {
  deposit: Pick<Deposit, 'kind' | 'currency'>;
  size?: 'sm' | 'md' | 'lg';
}) {
  const { color, glyph } = depositIdentity(deposit.kind ?? 'term-deposit', deposit.currency);
  return (
    <span
      className={`asset-icon asset-icon--${size}`}
      style={{ background: color }}
      data-glyph={glyph}
      aria-hidden="true"
    />
  );
}
