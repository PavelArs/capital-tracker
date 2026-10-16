import { accountingApi, type WalletKind } from '@api/accounting.api';
import { type FormEvent, useRef, useState } from 'react';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Input, Select } from '@/ui/inputs';
import Modal, { ModalBody, ModalFooter, ModalHeader } from '@/ui/Modal';
import { requestFailure } from '@/utils/request-failure';
import { kindLabels, walletKinds } from './wallets';

const MAX_NAME = 120;

const failure = (error: unknown) =>
  requestFailure(error, {
    unreachable: 'Could not reach the server. Try again.',
    status: {
      400: 'Use a name of 1 to 120 characters on one line.',
      404: 'This wallet no longer exists. Reload the page.',
      401: 'Your session has ended. Sign in again.',
    },
    fallback: 'Could not save the wallet. Try again.',
  });

interface Props {
  accountId: string;
  name: string;
  kind: WalletKind | null;
  onClose: () => void;
  /** What changed, so the page can say so (wallets-21). */
  onSaved: (changes: { name?: string; kind?: WalletKind | null }) => void;
}

const NOT_CHOSEN = '';

// WAL-RENAME, W1, prototype "Rename wallet": the name and how the wallet is held change;
// transactions stay as they are.
export default function EditWalletDialog({ accountId, name, kind, onClose, onSaved }: Props) {
  const [value, setValue] = useState(name);
  const [chosen, setChosen] = useState<WalletKind | typeof NOT_CHOSEN>(kind ?? NOT_CHOSEN);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const trimmed = value.trim();
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!trimmed) {
      setError('Enter a name.');
      return;
    }
    const nextKind = chosen === NOT_CHOSEN ? null : chosen;
    const changes = {
      ...(trimmed === name ? {} : { name: trimmed }),
      ...(nextKind === kind ? {} : { kind: nextKind }),
    };
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await accountingApi.updateAccount(accountId, changes);
      onSaved(changes);
    } catch (caught) {
      setError(failure(caught));
      setSaving(false);
    }
  };

  return (
    <Modal
      titleId="edit-wallet"
      size="narrow"
      onEscape={saving ? undefined : onClose}
      initialFocus={() => {
        input.current?.select();
        return input.current;
      }}
    >
      <form onSubmit={save} noValidate>
        <ModalHeader titleId="edit-wallet" title="Edit wallet" />
        <ModalBody>
          <Field
            id="wallet-new-name"
            label="Name"
            hint="Transactions, addresses and balances stay as they are."
          >
            {(control) => (
              <Input
                {...control}
                ref={input}
                maxLength={MAX_NAME}
                value={value}
                aria-invalid={error ? true : undefined}
                onChange={(event) => setValue(event.target.value)}
              />
            )}
          </Field>
          <Field id="wallet-kind" label="How you hold it">
            {(control) => (
              <Select
                {...control}
                value={chosen}
                onChange={(event) =>
                  setChosen(event.target.value as WalletKind | typeof NOT_CHOSEN)
                }
              >
                <option value={NOT_CHOSEN}>Not chosen</option>
                {walletKinds.map((item) => (
                  <option key={item} value={item}>
                    {kindLabels[item]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {error && <Banner tone="neg">{error}</Banner>}
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <span className="ui-grow" />
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
