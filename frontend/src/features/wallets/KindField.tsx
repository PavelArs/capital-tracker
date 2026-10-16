import type { WalletKind } from '@api/accounting.api';
import { Field } from '@/ui/Field';
import { Select } from '@/ui/inputs';
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
    <Field
      id={id}
      label={
        <>
          How you hold it <span className="ui-muted">(optional)</span>
        </>
      }
    >
      {(control) => (
        <Select
          {...control}
          value={value}
          onChange={(event) => onChange(event.target.value as KindChoice)}
        >
          <option value="">Not chosen</option>
          {walletKinds.map((kind) => (
            <option key={kind} value={kind}>
              {kindLabels[kind]}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}
