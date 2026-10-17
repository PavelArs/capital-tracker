import { securityApi } from '@api/security.api';
import { useToast } from '@contexts/ToastContext';
import { isAxiosError } from 'axios';
import { type FormEvent, useRef, useState } from 'react';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Input } from '@/ui/inputs';
import { ModalBody, ModalFooter } from '@/ui/Modal';
import { tooManyAttempts } from './attempts';
import SecurityDialog from './SecurityDialog';

const invalid = 'That code is not valid. Enter the current code from your authenticator app.';

function failure(error: unknown): string {
  if (!isAxiosError(error)) return 'Could not make new codes. Your current codes still work.';
  const status = error.response?.status;
  if (status === undefined) return 'Could not reach the server. Try again.';
  if (status === 400 || status === 422) return invalid;
  if (status === 429) return tooManyAttempts(error);
  return 'Could not make new codes. Your current codes still work.';
}

interface Props {
  unused: number;
  onGenerated: (count: number) => void;
  onClose: () => void;
}

// SEC-CODES, prototype "Generate new codes": a fresh TOTP, then ten codes shown only once.
export default function RecoveryCodesDialog({ unused, onGenerated, onClose }: Props) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  // auth-02: after a refused code the keyboard goes back to the field.
  const field = useRef<HTMLInputElement>(null);

  const generate = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const digits = code.replace(/\s/g, '');
    if (!/^[0-9]{6}$/.test(digits)) {
      setError('Enter the 6-digit code from your authenticator app.');
      field.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const fresh = await securityApi.regenerateRecoveryCodes(digits);
      setCodes(fresh);
      onGenerated(fresh.length);
    } catch (caught) {
      setError(failure(caught));
      setCode('');
      field.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  if (codes) {
    return (
      <ShownCodes
        codes={codes}
        title="New recovery codes"
        titleId="security-codes-new"
        note="These replace your old codes and are shown only now. Each works once."
        size="narrow"
        onDone={onClose}
      />
    );
  }

  return (
    <SecurityDialog
      key="totp"
      title="Generate new recovery codes"
      titleId="security-codes"
      size="narrow"
      onClose={onClose}
      busy={busy}
    >
      <form onSubmit={generate} noValidate>
        <ModalBody>
          <p className="security-dialog__text">
            Your {unused} unused {unused === 1 ? 'code stops' : 'codes stop'} working as soon as the
            new ones are made. You see the new codes only once.
          </p>
          <Field id="security-totp" label="Code from your authenticator app">
            {(control) => (
              <Input
                {...control}
                ref={field}
                className="security-otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                value={code}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'security-totp-error' : undefined}
                onChange={(event) => setCode(event.target.value)}
              />
            )}
          </Field>
          {error && (
            <Banner id="security-totp-error" tone="neg">
              {error}
            </Banner>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          {/* auth-02: aria-disabled, not disabled, so focus is not dropped while it checks. */}
          <Button type="submit" variant="primary" aria-disabled={busy}>
            {busy ? 'Generating…' : 'Generate new codes'}
          </Button>
        </ModalFooter>
      </form>
    </SecurityDialog>
  );
}

interface ShownCodesProps {
  codes: string[];
  title: string;
  titleId: string;
  note: string;
  /** The step of a longer flow, drawn under the heading. */
  steps?: { current: number; total: number };
  size?: 'narrow' | 'default';
  onDone: () => void;
}

// Shown once: no Escape and no ✕, the owner confirms the codes are saved.
export function ShownCodes({ codes, title, titleId, note, steps, size, onDone }: ShownCodesProps) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const done = () => {
    if (!saved) {
      setError('Confirm that you saved the codes.');
      return;
    }
    toast.show({ tone: 'success', title: 'New recovery codes are active' });
    onDone();
  };

  return (
    <SecurityDialog title={title} titleId={titleId} size={size} steps={steps}>
      <ModalBody>
        <Banner tone="warn">{note}</Banner>
        <ul className="security-codes" aria-label="Recovery codes">
          {codes.map((value) => (
            <li key={value}>{value}</li>
          ))}
        </ul>
        <Button
          className="security-copy"
          icon={copied ? 'check' : 'copy'}
          onClick={() => void copy()}
        >
          {copied ? 'Copied' : 'Copy codes'}
        </Button>
        <label className="security-check">
          <input
            type="checkbox"
            checked={saved}
            onChange={(event) => {
              setSaved(event.target.checked);
              if (event.target.checked) setError(null);
            }}
          />
          I have saved these codes
        </label>
        {error && <Banner tone="neg">{error}</Banner>}
      </ModalBody>
      <ModalFooter>
        <Button variant="primary" onClick={done}>
          Done
        </Button>
      </ModalFooter>
    </SecurityDialog>
  );
}
