import { manualPricesApi } from '@api/manual-prices.api';
import type { ValuationCurrency } from '@api/portfolio-assets.api';
import { useToast } from '@contexts/ToastContext';
import { isAxiosError } from 'axios';
import { type FormEvent, useId, useRef, useState } from 'react';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Affix, Input } from '@/ui/inputs';
import Modal, { ModalBody, ModalFooter, ModalHeader } from '@/ui/Modal';
import { requestFailure } from '@/utils/request-failure';
import { newRequestId } from '../accounting/feedback';
import { numberProblem, positive } from './add-transaction';
import { useFocusFirstProblem } from './focus-problem';

const status = (error: unknown) => (isAxiosError(error) ? error.response?.status : undefined);

const failure = (error: unknown) =>
  requestFailure(error, {
    unreachable:
      'Could not reach the server. Try again; the same request will not save the price twice.',
    status: {
      400: 'Check the price and try again.',
      404: 'This asset no longer exists. Reload the page.',
      409: 'The price was changed elsewhere. Try again.',
      401: 'Your session has ended. Sign in again.',
    },
    fallback: 'Could not save the price. Try again.',
  });

interface Props {
  instrumentId: string;
  name: string;
  /** The currency the asset is valued in; the price is entered and kept in it. */
  currency: ValuationCurrency;
  onClose: () => void;
  onSaved: () => void;
}

// G1: changing the price of a hand-valued asset after it exists. It replaces the manual prices
// screen: one new price from now on, in the currency the asset is valued in, so 500,000 RUB
// stays 500,000 RUB as the dollar rate moves (AST-MANUAL-VALUE). The page shows it in the
// chosen currency.
export default function UpdatePriceDialog({
  instrumentId,
  name,
  currency,
  onClose,
  onSaved,
}: Props) {
  const [value, setValue] = useState('');
  const [left, setLeft] = useState(false);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // One request id per distinct price, so a retry after a lost answer cannot save it twice. The
  // revision and the moment are kept with it: the same command is sent again, not a new one.
  const attempt = useRef<{
    price: string;
    requestId: string;
    observedAt: string;
    expectedRevision: number;
  } | null>(null);
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const { form, refused } = useFocusFirstProblem();
  const toast = useToast();

  const price = positive(value);
  const problem = price === null ? numberProblem(value, 'Enter a price greater than 0') : null;
  const shown = problem !== null && (tried || left);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (price === null) {
      refused();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (attempt.current?.price !== price) {
        const book = await manualPricesApi.list(instrumentId, 0);
        attempt.current = {
          price,
          requestId: newRequestId(),
          // Whole seconds, so the saved moment reads back exactly as sent.
          observedAt: `${new Date().toISOString().slice(0, 19)}Z`,
          expectedRevision: book.currentRevision,
        };
      }
      await manualPricesApi.set(instrumentId, {
        requestId: attempt.current.requestId,
        expectedRevision: attempt.current.expectedRevision,
        observedAt: attempt.current.observedAt,
        price,
        currency,
        assertReviewed: true,
      });
      toast.show({
        tone: 'success',
        title: 'Price updated',
        detail: `${name} uses the new price from now on.`,
      });
      onSaved();
    } catch (caught) {
      setError(failure(caught));
      setSaving(false);
      // A refused request saved nothing: the retry starts from the current revision.
      if (status(caught) === 409 || status(caught) === 400) attempt.current = null;
    }
  };

  return (
    <Modal
      titleId={`${id}-title`}
      size="narrow"
      onEscape={saving ? undefined : onClose}
      initialFocus={() => {
        input.current?.select();
        return input.current;
      }}
    >
      <form ref={form} onSubmit={save} noValidate>
        <ModalHeader
          titleId={`${id}-title`}
          title="Update price"
          onClose={onClose}
          closeDisabled={saving}
          intro={`${name} is valued by hand. The new price applies from now on; earlier days keep the price they had.`}
        />
        <ModalBody>
          <Field
            id={`${id}-price`}
            label={`Price of one unit, ${currency}`}
            error={shown ? problem : null}
          >
            {(control) => (
              <Affix suffix={currency}>
                <Input
                  {...control}
                  ref={input}
                  numeric
                  autoComplete="off"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  onBlur={() => setLeft(true)}
                />
              </Affix>
            )}
          </Field>
          {error && <Banner tone="neg">{error}</Banner>}
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save price'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
