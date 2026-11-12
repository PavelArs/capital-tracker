import {
  createContext,
  type FormEvent,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { Banner } from './Banner';
import { Button } from './Button';
import Modal, { ModalBody, ModalFooter, ModalHeader } from './Modal';

/** What is wrong with each field, by its key; a field that is fine has none. */
export type Problems = Partial<Record<string, string | null>>;

export const hasProblems = (problems: Problems) => Object.values(problems).some(Boolean);

/** The problems shown under the fields: none until the owner tried to save. */
const ShownProblems = createContext<Problems>({});

/** The problem said under the field with this key in a FormDialog; null before the first try. */
export function useShownProblem(name: string | undefined): string | null {
  const problems = useContext(ShownProblems);
  return name ? (problems[name] ?? null) : null;
}

/**
 * A form dialog's buttons: Cancel, then the submit. Both wait while the save is in flight, and
 * the submit then says "Saving…".
 */
export function SaveFooter({
  label,
  saving,
  onCancel,
  variant = 'primary',
}: {
  label: string;
  saving: boolean;
  onCancel: () => void;
  /** The goal dialog draws its submit as a secondary button. */
  variant?: 'primary' | 'secondary';
}) {
  return (
    <ModalFooter>
      <Button variant="ghost" disabled={saving} onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" variant={variant} disabled={saving}>
        {saving ? 'Saving…' : label}
      </Button>
    </ModalFooter>
  );
}

/**
 * One modal form: a title, fields, a refusal line and Cancel/Save. Each field's problem is shown
 * under it (read it with `useShownProblem`) once the owner tried to save; a save refused for them
 * sends nothing and puts the keyboard on the first field that needs a fix.
 */
export function FormDialog({
  title,
  note,
  submit,
  submitVariant,
  problems,
  failure,
  size = 'default',
  onClose,
  onSubmit,
  children,
}: {
  title: string;
  note?: string;
  submit: string;
  submitVariant?: 'primary' | 'secondary';
  /** Every field's problem, by the field's key. */
  problems: () => Problems;
  /** What to say when the save fails, made from the error. */
  failure: (error: unknown) => string;
  size?: 'default' | 'wide';
  onClose: () => void;
  onSubmit: () => Promise<void>;
  children: ReactNode;
}) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState(0);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (refused > 0)
      form.current?.querySelector<HTMLElement>('[aria-invalid="true"]:not(:disabled)')?.focus();
  }, [refused]);

  const shown = tried ? problems() : {};
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (hasProblems(problems())) {
      setRefused((count) => count + 1);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit();
    } catch (caught) {
      setError(failure(caught));
      setSaving(false);
    }
  };

  return (
    <Modal
      titleId={`${id}-title`}
      size={size}
      onEscape={saving ? undefined : onClose}
      initialFocus={(root) => root.querySelector<HTMLElement>('input, select')}
    >
      <form ref={form} onSubmit={save} noValidate>
        <ModalHeader
          titleId={`${id}-title`}
          title={title}
          onClose={onClose}
          closeDisabled={saving}
          intro={note}
        />
        <ModalBody>
          <ShownProblems.Provider value={shown}>{children}</ShownProblems.Provider>
          {error && <Banner tone="neg">{error}</Banner>}
        </ModalBody>
        <SaveFooter label={submit} saving={saving} onCancel={onClose} variant={submitVariant} />
      </form>
    </Modal>
  );
}
