import { securityApi } from '@api/security.api';
import { isAxiosError } from 'axios';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Icon } from '../shell/icons';
import SecurityDialog from './SecurityDialog';

const invalid = 'That code is not valid. Enter the current code from your authenticator app.';

function failure(error: unknown): string {
  if (!isAxiosError(error)) return 'Could not make new codes. Your current codes still work.';
  const status = error.response?.status;
  if (status === undefined) return 'Could not reach the server. Try again.';
  if (status === 400 || status === 422) return invalid;
  if (status === 429) {
    const wait = Number(error.response?.headers?.['retry-after']);
    return Number.isFinite(wait) && wait > 0 && wait <= 60
      ? 'Too many attempts. Wait a minute and try again.'
      : 'Too many attempts. Wait 10 minutes and try again.';
  }
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

  const generate = async (event: FormEvent) => {
    event.preventDefault();
    const digits = code.replace(/\s/g, '');
    if (!/^[0-9]{6}$/.test(digits)) {
      setError('Enter the 6-digit code from your authenticator app.');
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
        onDone={onClose}
      />
    );
  }

  return (
    <SecurityDialog
      key="totp"
      title="Generate new recovery codes"
      titleId="security-codes"
      onEscape={busy ? undefined : onClose}
    >
      <form onSubmit={generate} noValidate>
        <div className="portfolio-dialog__body">
          <p className="security-dialog__text">
            Your {unused} unused {unused === 1 ? 'code stops' : 'codes stop'} working as soon as the
            new ones are made. You see the new codes only once.
          </p>
          <div className="portfolio-field">
            <label className="portfolio-field__label" htmlFor="security-totp">
              Code from your authenticator app
            </label>
            <input
              id="security-totp"
              className="portfolio-input security-otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              value={code}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'security-totp-error' : undefined}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          {error && (
            <p id="security-totp-error" className="portfolio-dialog__error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="portfolio-dialog__foot">
          <button
            type="button"
            className="shell-button shell-button--ghost"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button type="submit" className="shell-button shell-button--primary" disabled={busy}>
            {busy ? 'Generating…' : 'Generate new codes'}
          </button>
        </div>
      </form>
    </SecurityDialog>
  );
}

interface ShownCodesProps {
  codes: string[];
  title: string;
  titleId: string;
  note: string;
  /** A line above the note, such as the step of a longer flow. */
  lead?: ReactNode;
  onDone: () => void;
}

// Shown once: no Escape, the owner confirms the codes are saved.
export function ShownCodes({ codes, title, titleId, note, lead, onDone }: ShownCodesProps) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    onDone();
  };

  return (
    <SecurityDialog title={title} titleId={titleId}>
      <div className="portfolio-dialog__body">
        {lead}
        <p className="security-note security-note--warn">
          <Icon name="alert" className="shell-icon shell-icon--sm" />
          {note}
        </p>
        <ul className="security-codes" aria-label="Recovery codes">
          {codes.map((value) => (
            <li key={value}>{value}</li>
          ))}
        </ul>
        <button
          type="button"
          className="shell-button shell-button--secondary security-copy"
          onClick={() => void copy()}
        >
          <Icon name={copied ? 'check' : 'copy'} className="shell-icon shell-icon--sm" />
          {copied ? 'Copied' : 'Copy codes'}
        </button>
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
        {error && (
          <p className="portfolio-dialog__error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="portfolio-dialog__foot">
        <button type="button" className="shell-button shell-button--primary" onClick={done}>
          Done
        </button>
      </div>
    </SecurityDialog>
  );
}
