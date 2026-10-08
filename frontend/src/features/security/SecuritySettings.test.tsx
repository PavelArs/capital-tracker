import { type SecurityOverview, securityApi } from '@api/security.api';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SecuritySettings from './SecuritySettings';

const logoutEverywhere = vi.fn();
vi.mock('@contexts/AuthContext', () => ({ useAuth: () => ({ logoutEverywhere }) }));

// Synthetic sessions and codes only.
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const overview = (changes: Partial<SecurityOverview> = {}): SecurityOverview => ({
  recoveryCodes: { unused: 7, total: 10 },
  sessions: [
    {
      id: 'a'.repeat(32),
      device: 'Chrome on macOS',
      signedInAt: '2026-10-08T07:12:00.000Z',
      lastActiveAt: minutesAgo(0),
      current: true,
    },
    {
      id: 'b'.repeat(32),
      device: 'Safari on iPhone',
      signedInAt: '2026-10-07T18:40:00.000Z',
      lastActiveAt: minutesAgo(35),
      current: false,
    },
    {
      id: 'c'.repeat(32),
      device: null,
      signedInAt: '2026-10-06T09:00:00.000Z',
      lastActiveAt: minutesAgo(26 * 60),
      current: false,
    },
  ],
  ...changes,
});
const newCodes = Array.from({ length: 10 }, (_, index) =>
  [0, 1, 2, 3].map((group) => `${index}${group}`.repeat(4)).join('-'),
);

function failure(status: number) {
  const headers = new AxiosHeaders();
  return new AxiosError('failed', String(status), { headers }, null, {
    status,
    statusText: '',
    headers: {},
    config: { headers },
    data: {},
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  logoutEverywhere.mockReset();
  vi.spyOn(securityApi, 'get').mockResolvedValue(overview());
});

afterEach(cleanup);

const region = () => screen.getByRole('region', { name: 'Security' });

describe('Settings → Security (PR-AUTH-4)', () => {
  it('shows the factor, unused recovery codes and every signed-in browser', async () => {
    render(<SecuritySettings />);
    expect(await within(region()).findByText(/7 of 10 unused/)).toBeInTheDocument();
    expect(within(region()).getByText('On')).toBeInTheDocument();
    const rows = within(screen.getByRole('list', { name: 'Active sessions' })).getAllByRole(
      'listitem',
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Chrome on macOS');
    expect(rows[0]).toHaveTextContent('Active now');
    expect(within(rows[0]).getByText('This browser')).toBeInTheDocument();
    expect(within(rows[0]).queryByRole('button')).toBeNull();
    expect(rows[1]).toHaveTextContent('Active 35 min ago');
    expect(within(rows[1]).getByRole('button', { name: 'Log out Safari on iPhone' })).toBeVisible();
    expect(rows[2]).toHaveTextContent('Unknown device');
    expect(rows[2]).toHaveTextContent('Signed in');
  });

  it('says so and offers a retry when the settings cannot load', async () => {
    vi.mocked(securityApi.get).mockRejectedValueOnce(failure(500));
    render(<SecuritySettings />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load your security settings.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await within(region()).findByText(/7 of 10 unused/)).toBeInTheDocument();
  });

  it('SEC-CODES: asks for a TOTP, shows ten new codes once and needs them saved', async () => {
    const regenerate = vi
      .spyOn(securityApi, 'regenerateRecoveryCodes')
      .mockRejectedValueOnce(failure(422))
      .mockRejectedValueOnce(failure(429))
      .mockResolvedValueOnce(newCodes);
    render(<SecuritySettings />);
    await userEvent.click(await screen.findByRole('button', { name: 'Generate new codes' }));
    const dialog = screen.getByRole('dialog', { name: 'Generate new recovery codes' });
    expect(dialog).toHaveTextContent('Your 7 unused codes stop working');
    const field = within(dialog).getByLabelText('Code from your authenticator app');
    expect(field).toHaveFocus();
    const submit = within(dialog).getByRole('button', { name: 'Generate new codes' });

    await userEvent.click(submit);
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Enter the 6-digit code from your authenticator app.',
    );
    expect(regenerate).not.toHaveBeenCalled();

    await userEvent.type(field, '123456');
    await userEvent.click(submit);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'That code is not valid. Enter the current code from your authenticator app.',
    );
    expect(field).toHaveValue('');
    await userEvent.type(field, '234567');
    await userEvent.click(submit);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Too many attempts. Wait 10 minutes and try again.',
    );
    await userEvent.type(field, '345678');
    await userEvent.click(submit);
    expect(regenerate).toHaveBeenLastCalledWith('345678');

    const shown = await screen.findByRole('dialog', { name: 'New recovery codes' });
    const codes = within(within(shown).getByRole('list', { name: 'Recovery codes' })).getAllByRole(
      'listitem',
    );
    expect(codes.map((code) => code.textContent)).toEqual(newCodes);
    expect(shown).toHaveTextContent('shown only now');
    expect(within(region()).getByText(/10 of 10 unused/)).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'New recovery codes' })).toBeInTheDocument();
    await userEvent.click(within(shown).getByRole('button', { name: 'Done' }));
    expect(within(shown).getByRole('alert')).toHaveTextContent('Confirm that you saved the codes.');
    await userEvent.click(within(shown).getByLabelText('I have saved these codes'));
    await userEvent.click(within(shown).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(newCodes[0])).toBeNull();
  });

  it('copies the new codes to the clipboard', async () => {
    vi.spyOn(securityApi, 'regenerateRecoveryCodes').mockResolvedValue(newCodes);
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    render(<SecuritySettings />);
    await user.click(await screen.findByRole('button', { name: 'Generate new codes' }));
    await user.type(screen.getByLabelText('Code from your authenticator app'), '123456');
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Generate new codes' }),
    );
    await user.click(await screen.findByRole('button', { name: 'Copy codes' }));
    expect(write).toHaveBeenCalledWith(newCodes.join('\n'));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('logs out one other session after a confirmation', async () => {
    const end = vi.spyOn(securityApi, 'endSession').mockResolvedValue();
    render(<SecuritySettings />);
    await userEvent.click(await screen.findByRole('button', { name: 'Log out Safari on iPhone' }));
    const confirm = screen.getByRole('dialog', { name: 'Log out this session?' });
    expect(confirm).toHaveTextContent('Safari on iPhone is signed out');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(end).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Log out Safari on iPhone' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Log out session' }),
    );
    expect(end).toHaveBeenCalledWith('b'.repeat(32));
    await waitFor(() => expect(screen.queryByText('Safari on iPhone')).toBeNull());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the list when a session cannot be logged out', async () => {
    vi.spyOn(securityApi, 'endSession').mockRejectedValue(failure(500));
    render(<SecuritySettings />);
    await userEvent.click(await screen.findByRole('button', { name: 'Log out Unknown device' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Log out session' }),
    );
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(
      'Could not log out this session. Try again.',
    );
    expect(screen.getAllByText('Unknown device').length).toBeGreaterThan(0);
  });

  it('SEC-SESSIONS: log out everywhere ends this browser too', async () => {
    logoutEverywhere.mockResolvedValue(undefined);
    render(<SecuritySettings />);
    await userEvent.click(await screen.findByRole('button', { name: 'Log out everywhere' }));
    const confirm = screen.getByRole('dialog', { name: 'Log out everywhere?' });
    expect(confirm).toHaveTextContent('including this browser');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Log out everywhere' }));
    expect(logoutEverywhere).toHaveBeenCalledTimes(1);
  });

  it('stays signed in and says so when log out everywhere fails', async () => {
    logoutEverywhere.mockRejectedValue(failure(503));
    render(<SecuritySettings />);
    await userEvent.click(await screen.findByRole('button', { name: 'Log out everywhere' }));
    const confirm = screen.getByRole('dialog', { name: 'Log out everywhere?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Log out everywhere' }));
    expect(await within(confirm).findByRole('alert')).toHaveTextContent(
      'Could not log out. Nothing changed; try again.',
    );
  });

  it('says when only this browser is signed in', async () => {
    vi.mocked(securityApi.get).mockResolvedValue(
      overview({ sessions: overview().sessions.slice(0, 1) }),
    );
    render(<SecuritySettings />);
    expect(await screen.findByText('Only this browser is signed in.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log out everywhere' })).toBeVisible();
  });
});
