import { type PropertyDetails, propertyDetailsApi } from '@api/property-details.api';
import { useToast } from '@contexts/ToastContext';
import { type FormEvent, useId, useRef, useState } from 'react';
import { Banner } from '@/ui/Banner';
import { Field } from '@/ui/Field';
import { SaveFooter } from '@/ui/FormDialog';
import { Affix, Input, Textarea } from '@/ui/inputs';
import Modal, { ModalBody, ModalHeader } from '@/ui/Modal';
import { requestFailure } from '@/utils/request-failure';
import { useFocusFirstProblem } from '../portfolio/focus-problem';

/** Kept in step with the server: a note of at most 500 characters. */
export const MAX_NOTE = 500;

const RENT = /^(0|[1-9]\d{0,11})(\.\d{1,2})?$/;

/** The rent as the server takes it: empty is no rent, anything else a positive sum in cents. */
export function rentProblem(value: string): string | null {
  const rent = value.trim();
  if (rent === '') return null;
  return RENT.test(rent) && /[1-9]/.test(rent)
    ? null
    : 'Enter a rent of at most two decimals, or leave it empty';
}

const failure = (error: unknown) =>
  requestFailure(error, {
    unreachable:
      'Could not reach the server. Try again; saving the same details twice changes nothing.',
    status: {
      400: 'Check the rent and the note and try again.',
      404: 'This property no longer exists. Reload the page.',
      401: 'Your session has ended. Sign in again.',
    },
    fallback: 'Could not save the details. Try again.',
  });

// PROP-DETAILS: the rent a month and a free note kept with a property. Neither is part of its
// value: the rent is shown as entered, and a mortgage or another debt is not subtracted.
export default function PropertyDetailsDialog({
  instrumentId,
  currency,
  details,
  onClose,
  onSaved,
}: {
  instrumentId: string;
  /** The currency the property is valued in; the rent is entered and kept in it. */
  currency: PropertyDetails['currency'];
  details: PropertyDetails | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rent, setRent] = useState(details?.monthlyRent ?? '');
  const [note, setNote] = useState(details?.note ?? '');
  const [tried, setTried] = useState(false);
  const [left, setLeft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const id = useId();
  const first = useRef<HTMLInputElement>(null);
  const { form, refused } = useFocusFirstProblem();
  const toast = useToast();
  const problem = rentProblem(rent);
  const shown = problem !== null && (tried || left);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (problem !== null) {
      refused();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await propertyDetailsApi.set(instrumentId, {
        monthlyRent: rent.trim() === '' ? null : rent.trim(),
        note: note.trim() === '' ? null : note.trim(),
      });
      toast.show({ tone: 'success', title: 'Details saved' });
      onSaved();
    } catch (caught) {
      setError(failure(caught));
      setSaving(false);
    }
  };

  return (
    <Modal
      titleId={`${id}-title`}
      size="narrow"
      onEscape={saving ? undefined : onClose}
      initialFocus={() => first.current}
    >
      <form ref={form} onSubmit={save} noValidate>
        <ModalHeader
          titleId={`${id}-title`}
          title="Rent and notes"
          onClose={onClose}
          closeDisabled={saving}
          intro="Shown as you enter them. A mortgage or other debt is not subtracted from the value."
        />
        <ModalBody>
          <Field
            id={`${id}-rent`}
            label={`Rent a month, ${currency}`}
            hint="The rent of the whole property, as you enter it. Leave empty when it brings no rent."
            error={shown ? problem : null}
          >
            {(control) => (
              <Affix suffix={currency}>
                <Input
                  {...control}
                  ref={first}
                  numeric
                  autoComplete="off"
                  value={rent}
                  onChange={(event) => setRent(event.target.value)}
                  onBlur={() => setLeft(true)}
                />
              </Affix>
            )}
          </Field>
          <Field
            id={`${id}-note`}
            label="Notes"
            hint={`A mortgage, a tenant, a contract end. Up to ${MAX_NOTE} characters.`}
          >
            {(control) => (
              <Textarea
                {...control}
                rows={4}
                maxLength={MAX_NOTE}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            )}
          </Field>
          {error && <Banner tone="neg">{error}</Banner>}
        </ModalBody>
        <SaveFooter label="Save" saving={saving} onCancel={onClose} />
      </form>
    </Modal>
  );
}
