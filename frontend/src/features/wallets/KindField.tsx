import type { WalletKind } from '@api/accounting.api';
import { kindLabels, walletKinds } from './wallets';

/** "Not chosen" until the owner picks one of the kinds. */
export type KindChoice = WalletKind | '';

/** W1: how the owner holds a new wallet; optional, and it can be changed later on its page. */
export default function KindField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: KindChoice;
  onChange: (kind: KindChoice) => void;
}) {
  return (
    <div className="portfolio-field">
      <label className="portfolio-field__label" htmlFor={id}>
        How you hold it <span className="wallets-muted">(optional)</span>
      </label>
      <select
        id={id}
        className="portfolio-input"
        value={value}
        onChange={(event) => onChange(event.target.value as KindChoice)}
      >
        <option value="">Not chosen</option>
        {walletKinds.map((kind) => (
          <option key={kind} value={kind}>
            {kindLabels[kind]}
          </option>
        ))}
      </select>
    </div>
  );
}
