import { type AuthenticatorSetup, securityApi } from '@api/security.api';
import { isAxiosError } from 'axios';
import { type FormEvent, useState } from 'react';
import { Icon } from '../shell/icons';
import QrCode from './QrCode';
import { ShownCodes } from './RecoveryCodesDialog';
import SecurityDialog from './SecurityDialog';

type Kind = 'totp' | 'recovery';

const recoveryPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{8}){3}$/i;
const tooMany = 'Too many attempts. Wait 10 minutes and try again.';
const unreachable = 'Could not reach the server. Try again.';

function proofFailure(error: unknown, kind: Kind): string {
  const status = isAxiosError(error) ? error.response?.status : undefined;
  if (isAxiosError(error) && status === undefined) return unreachable;
  if (status === 400 || status === 422)
    return kind === 'totp'
      ? 'That code is not valid. Enter the current code from your authenticator app.'
      : 'That recovery code is not valid or was already used.';
  if (status === 429) return tooMany;
  return 'Could not start the setup. Nothing changed.';
}

function confirmFailure(error: unknown): { message: string; expired?: boolean } {
  const status = isAxiosError(error) ? error.response?.status : undefined;
  if (isAxiosError(error) && status === undefined) return { message: unreachable };
  if (status === 400 || status === 422)
    return { message: 'That code is not valid. Enter the current code from the new app.' };
  if (status === 410)
    return {
      message:
        'This setup expired or had too many wrong codes. Start again; your current authenticator still works.',
      expired: true,
    };
  if (status === 429) return { message: 'Too many attempts. Wait a minute and try again.' };
  return { message: 'Could not finish the setup. Your current authenticator still works.' };
}

// The key in groups of four, as authenticator apps show it.
const grouped = (secret: string) => secret.match(/.{1,4}/g)?.join(' ') ?? secret;

interface Props {
  onFinished: () => void;
  onClose: () => void;
}

// SEC-TOTP, prototype "2FA setup": prove the current factor, scan a new key, confirm it with
// the new app's first code, then save the recovery codes that replace the old ones.
export default function AuthenticatorDialog({ onFinished, onClose }: Props) {
  const [kind, setKind] = useState<Kind>('totp');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState<AuthenticatorSetup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);

  const switchKind = () => {
    setKind((current) => (current === 'totp' ? 'recovery' : 'totp'));
    setCode('');
    setError(null);
  };

  const prove = async (event: FormEvent) => {
    event.preventDefault();
    const value = kind === 'totp' ? code.replace(/\s/g, '') : code.trim();
    if (kind === 'totp' ? !/^[0-9]{6}$/.test(value) : !recoveryPattern.test(value)) {
      setError(
        kind === 'totp'
          ? 'Enter the 6-digit code from your authenticator app.'
          : 'Recovery codes look like 1a2b3c4d-5e6f7a8b-9c0d1e2f-3a4b5c6d.',
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setSetup(await securityApi.prepareAuthenticator({ kind, code: value }));
      setExpired(false);
    } catch (caught) {
      setError(proofFailure(caught, kind));
    } finally {
      setCode('');
      setBusy(false);
    }
  };

  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    if (!setup) return;
    const digits = code.replace(/\s/g, '');
    if (!/^[0-9]{6}$/.test(digits)) {
      setError('Enter the 6-digit code from the new app.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setCodes(await securityApi.confirmAuthenticator(setup.candidateId, digits));
      setSetup(null);
      onFinished();
    } catch (caught) {
      const refused = confirmFailure(caught);
      setError(refused.message);
      setExpired(refused.expired === true);
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const startAgain = () => {
    setSetup(null);
    setExpired(false);
    setError(null);
    setKind('totp');
  };

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(setup?.secret ?? '');
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  if (codes) {
    return (
      <ShownCodes
        codes={codes}
        title="Save your new recovery codes"
        titleId="security-authenticator-codes"
        lead={<p className="security-step">Step 2 of 2</p>}
        note="The new authenticator is on and other browsers were signed out. These codes replace your old ones, work once each and are shown only now."
        onDone={onClose}
      />
    );
  }

  const errorBlock = error && (
    <p id="security-authenticator-error" className="portfolio-dialog__error" role="alert">
      {error}
    </p>
  );

  if (setup) {
    return (
      <SecurityDialog
        key="scan"
        title="Scan the new code"
        titleId="security-authenticator-scan"
        onEscape={busy ? undefined : onClose}
      >
        <form onSubmit={confirm} noValidate>
          <div className="portfolio-dialog__body">
            <p className="security-step">Step 1 of 2</p>
            <p className="security-dialog__text">
              Scan it with Google Authenticator, 1Password, Bitwarden or a similar app. Your current
              authenticator keeps working until you finish.
            </p>
            <div className="security-qr-row">
              <QrCode value={setup.uri} label="QR code for your authenticator app" />
              <div className="security-key">
                <span className="portfolio-field__label">Can't scan? Enter this key</span>
                <div className="security-secret">
                  <span>{grouped(setup.secret)}</span>
                  <button
                    type="button"
                    className="shell-button shell-button--ghost security-secret__copy"
                    aria-label={copied ? 'Key copied' : 'Copy key'}
                    onClick={() => void copyKey()}
                  >
                    <Icon name={copied ? 'check' : 'copy'} className="shell-icon shell-icon--sm" />
                  </button>
                </div>
              </div>
            </div>
            <div className="portfolio-field">
              <label className="portfolio-field__label" htmlFor="security-new-totp">
                Code from the new app
              </label>
              <input
                id="security-new-totp"
                className="portfolio-input security-otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                value={code}
                disabled={expired}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'security-authenticator-error' : undefined}
                onChange={(event) => setCode(event.target.value)}
              />
            </div>
            {errorBlock}
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
            {expired ? (
              <button
                type="button"
                className="shell-button shell-button--primary"
                onClick={startAgain}
              >
                Start again
              </button>
            ) : (
              <button type="submit" className="shell-button shell-button--primary" disabled={busy}>
                {busy ? 'Checking…' : 'Verify and continue'}
              </button>
            )}
          </div>
        </form>
      </SecurityDialog>
    );
  }

  return (
    <SecurityDialog
      key={`prove-${kind}`}
      title="Set up authenticator again"
      titleId="security-authenticator"
      onEscape={busy ? undefined : onClose}
    >
      <form onSubmit={prove} noValidate>
        <div className="portfolio-dialog__body">
          <p className="security-dialog__text">
            For a new phone, or when the old one is lost. First confirm it's you
            {kind === 'totp'
              ? ' with a code from your current authenticator app.'
              : ' with one of your recovery codes; it is used up.'}
          </p>
          <div className="portfolio-field">
            <label className="portfolio-field__label" htmlFor="security-proof">
              {kind === 'totp' ? 'Code from your authenticator app' : 'Recovery code'}
            </label>
            <input
              id="security-proof"
              className={
                kind === 'totp'
                  ? 'portfolio-input security-otp'
                  : 'portfolio-input security-recovery-input'
              }
              inputMode={kind === 'totp' ? 'numeric' : 'text'}
              autoComplete={kind === 'totp' ? 'one-time-code' : 'off'}
              autoCapitalize="none"
              spellCheck={false}
              maxLength={kind === 'totp' ? 7 : 40}
              value={code}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'security-authenticator-error' : undefined}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          {errorBlock}
          <button type="button" className="security-link" disabled={busy} onClick={switchKind}>
            {kind === 'totp' ? 'Lost the phone? Use a recovery code' : 'Use the authenticator code'}
          </button>
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
            {busy ? 'Checking…' : 'Continue'}
          </button>
        </div>
      </form>
    </SecurityDialog>
  );
}
