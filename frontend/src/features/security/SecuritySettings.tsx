import { type SecurityOverview, type SecuritySession, securityApi } from '@api/security.api';
import { useAuth } from '@contexts/AuthContext';
import { isAxiosError } from 'axios';
import { useCallback, useEffect, useState } from 'react';
import ConfirmDialog from './ConfirmDialog';
import RecoveryCodesDialog from './RecoveryCodesDialog';
import './security.css';

const signedIn = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const deviceName = (session: SecuritySession) => session.device ?? 'Unknown device';

function activity(lastActiveAt: string): string {
  const minutes = Math.floor((Date.now() - new Date(lastActiveAt).getTime()) / 60_000);
  if (minutes < 2) return 'Active now';
  if (minutes < 60) return `Active ${minutes} min ago`;
  return `Active ${Math.floor(minutes / 60)} h ago`;
}

type Dialog =
  | { kind: 'codes' }
  | { kind: 'session'; session: SecuritySession }
  | { kind: 'everywhere' };

// PR-AUTH-4, prototype Settings → Security: the factor, recovery codes and signed-in browsers.
export default function SecuritySettings() {
  const { logoutEverywhere } = useAuth();
  const [overview, setOverview] = useState<SecurityOverview | null>(null);
  const [failed, setFailed] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const load = useCallback(() => {
    let active = true;
    setFailed(false);
    securityApi
      .get()
      .then((value) => active && setOverview(value))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, []);
  useEffect(load, []);

  const endSession = async (session: SecuritySession) => {
    try {
      await securityApi.endSession(session.id);
    } catch (error) {
      // Already gone elsewhere: the list simply catches up.
      if (!isAxiosError(error) || error.response?.status !== 404) throw error;
    }
    setOverview(
      (current) =>
        current && {
          ...current,
          sessions: current.sessions.filter((item) => item.id !== session.id),
        },
    );
    setDialog(null);
  };

  const others = overview ? overview.sessions.filter((session) => !session.current).length : 0;
  return (
    <section className="shell-card" aria-labelledby="settings-security">
      <h2 id="settings-security">Security</h2>
      {failed ? (
        <div className="shell-setting">
          <p className="shell-setting__hint" role="alert">
            Could not load your security settings.
          </p>
          <button type="button" className="shell-button shell-button--secondary" onClick={load}>
            Try again
          </button>
        </div>
      ) : (
        <>
          <div className="shell-setting">
            <div className="shell-setting__text">
              <span className="shell-setting__label">Two-factor authentication</span>
              <p className="shell-setting__hint">
                Authenticator app. Required for this account, so it can't be turned off.
              </p>
            </div>
            <span className="security-badge">On</span>
          </div>
          <div className="shell-setting">
            <div className="shell-setting__text">
              <span className="shell-setting__label">Recovery codes</span>
              <p className="shell-setting__hint">
                {overview
                  ? `${overview.recoveryCodes.unused} of ${overview.recoveryCodes.total} unused. Each code signs you in once without your phone.`
                  : 'Loading…'}
              </p>
            </div>
            <button
              type="button"
              className="shell-button shell-button--secondary"
              disabled={!overview}
              onClick={() => setDialog({ kind: 'codes' })}
            >
              Generate new codes
            </button>
          </div>
          <div className="shell-setting security-sessions">
            <div className="shell-setting__text">
              <span id="security-sessions" className="shell-setting__label">
                Active sessions
              </span>
              <p className="shell-setting__hint">
                {!overview
                  ? 'Loading…'
                  : others === 0
                    ? 'Only this browser is signed in.'
                    : 'Browsers and devices signed in to this account.'}
              </p>
            </div>
            <button
              type="button"
              className="shell-button shell-button--secondary"
              disabled={!overview}
              onClick={() => setDialog({ kind: 'everywhere' })}
            >
              Log out everywhere
            </button>
            {overview && (
              <ul className="security-list" aria-labelledby="security-sessions">
                {overview.sessions.map((session) => (
                  <li key={session.id} className="security-row">
                    <span className="security-row__text">
                      <span className="security-row__name">{deviceName(session)}</span>
                      <span className="security-row__meta">
                        Signed in {signedIn.format(new Date(session.signedInAt))} ·{' '}
                        {activity(session.lastActiveAt)}
                      </span>
                    </span>
                    {session.current ? (
                      <span className="security-badge security-badge--plain">This browser</span>
                    ) : (
                      <button
                        type="button"
                        className="shell-button shell-button--ghost"
                        aria-label={`Log out ${deviceName(session)}`}
                        onClick={() => setDialog({ kind: 'session', session })}
                      >
                        Log out
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
      {dialog?.kind === 'codes' && overview && (
        <RecoveryCodesDialog
          unused={overview.recoveryCodes.unused}
          onGenerated={(count) =>
            setOverview(
              (current) =>
                current && { ...current, recoveryCodes: { unused: count, total: count } },
            )
          }
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'session' && (
        <ConfirmDialog
          title="Log out this session?"
          text={`${deviceName(dialog.session)} is signed out and has to sign in again with your password and a 2FA code.`}
          confirmLabel="Log out session"
          failure="Could not log out this session. Try again."
          onConfirm={() => endSession(dialog.session)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'everywhere' && (
        <ConfirmDialog
          title="Log out everywhere?"
          text="Every browser and device, including this browser, is signed out. Signing in again needs your password and a 2FA code."
          confirmLabel="Log out everywhere"
          failure="Could not log out. Nothing changed; try again."
          onConfirm={logoutEverywhere}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}
