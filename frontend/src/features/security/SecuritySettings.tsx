import { type SecurityOverview, type SecuritySession, securityApi } from '@api/security.api';
import { useAuth } from '@contexts/AuthContext';
import { useToast } from '@contexts/ToastContext';
import { isAxiosError } from 'axios';
import { useCallback, useEffect, useState } from 'react';
import Badge from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { Card, CardHeader } from '@/ui/Card';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { ErrorState } from '@/ui/ErrorState';
import { ListRowText } from '@/ui/ListRow';
import { SettingRow } from '@/ui/SettingRow';
import { Bone } from '../shell/Skeleton';
import AuthenticatorDialog from './AuthenticatorDialog';
import ChangePasswordDialog from './ChangePasswordDialog';
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
  | { kind: 'password' }
  | { kind: 'authenticator' }
  | { kind: 'codes' }
  | { kind: 'session'; session: SecuritySession }
  | { kind: 'everywhere' };

// PR-AUTH-4, prototype Settings → Security: the factor, recovery codes and signed-in browsers.
export default function SecuritySettings() {
  const { logoutEverywhere } = useAuth();
  const [overview, setOverview] = useState<SecurityOverview | null>(null);
  const [failed, setFailed] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const toast = useToast();

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
    <Card labelledBy="settings-security">
      <CardHeader id="settings-security" title="Security" />
      {failed ? (
        <ErrorState what="your security settings" onRetry={load} />
      ) : (
        <>
          <SettingRow
            title="Password"
            description="Asks for your current password and a code from your authenticator app."
            control={
              <Button disabled={!overview} onClick={() => setDialog({ kind: 'password' })}>
                Change password
              </Button>
            }
          />
          <SettingRow
            title="Two-factor authentication"
            description="Authenticator app. Always on; set it up again for a new phone."
            control={
              <>
                <Badge tone="pos" dot>
                  On
                </Badge>
                <Button disabled={!overview} onClick={() => setDialog({ kind: 'authenticator' })}>
                  Set up again
                </Button>
              </>
            }
          />
          <SettingRow
            title="Recovery codes"
            description={
              overview
                ? `${overview.recoveryCodes.unused} of ${overview.recoveryCodes.total} unused. Each code signs you in once without your phone.`
                : 'Loading…'
            }
            control={
              <Button disabled={!overview} onClick={() => setDialog({ kind: 'codes' })}>
                Generate new codes
              </Button>
            }
          />
          <SettingRow
            title="Active sessions"
            titleId="security-sessions"
            description={
              !overview
                ? 'Loading…'
                : others === 0
                  ? 'Only this browser is signed in.'
                  : 'Browsers and devices signed in to this account.'
            }
            control={
              <Button disabled={!overview} onClick={() => setDialog({ kind: 'everywhere' })}>
                Log out everywhere
              </Button>
            }
          />
          {!overview && (
            // At least this browser is listed, and most owners have one more.
            <ul className="ui-rows security-sessions" aria-hidden="true">
              {[0, 1].map((row) => (
                <li key={row} className="ui-row">
                  <span className="ui-row__main security-skeleton">
                    <Bone width={140} height={14} />
                    <Bone width={200} height={11} />
                  </span>
                  <Bone width={90} height={22} />
                </li>
              ))}
            </ul>
          )}
          {overview && (
            <ul className="ui-rows security-sessions" aria-labelledby="security-sessions">
              {overview.sessions.map((session) => (
                <li key={session.id} className="ui-row">
                  <ListRowText
                    title={deviceName(session)}
                    detail={`Signed in ${signedIn.format(new Date(session.signedInAt))} · ${activity(session.lastActiveAt)}`}
                    amount={
                      session.current ? (
                        <Badge tone="pos">This browser</Badge>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Log out ${deviceName(session)}`}
                          onClick={() => setDialog({ kind: 'session', session })}
                        >
                          Log out
                        </Button>
                      )
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {dialog?.kind === 'password' && (
        <ChangePasswordDialog
          onChanged={() => {
            toast.show({
              tone: 'success',
              title: 'Password changed',
              detail: 'Other sessions were signed out.',
            });
            load();
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'authenticator' && (
        <AuthenticatorDialog onFinished={load} onClose={() => setDialog(null)} />
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
          confirmLabel="Log out session"
          busyLabel="Logging out…"
          failure="Could not log out this session. Try again."
          onConfirm={() => endSession(dialog.session)}
          onClose={() => setDialog(null)}
        >
          {deviceName(dialog.session)} is signed out and has to sign in again with your password and
          a 2FA code.
        </ConfirmDialog>
      )}
      {dialog?.kind === 'everywhere' && (
        <ConfirmDialog
          title="Log out everywhere?"
          confirmLabel="Log out everywhere"
          busyLabel="Logging out…"
          failure="Could not log out. Nothing changed; try again."
          onConfirm={logoutEverywhere}
          onClose={() => setDialog(null)}
        >
          Every browser and device, including this browser, is signed out. Signing in again needs
          your password and a 2FA code.
        </ConfirmDialog>
      )}
    </Card>
  );
}
