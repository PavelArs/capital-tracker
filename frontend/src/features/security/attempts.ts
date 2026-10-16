import { isAxiosError } from 'axios';

/**
 * What to say after a 429 on a sign-in or security code, as far as the answer tells:
 * - The per-address request limit sends Retry-After (60 seconds at most): wait that long.
 * - The owner's code lock sends none. It is either the ten-minute cooldown after ten wrong codes
 *   or the lock after a hundred wrong codes in a row, which never lifts with time; the two answer
 *   alike (backend/src/auth/mfa.service.ts), and both refuse recovery codes too. So the copy
 *   promises no time and names the way out of the second: owner recovery on the server, which
 *   clears both (backend/src/owner-cli.ts).
 */
export function tooManyAttempts(error: unknown): string {
  const wait = isAxiosError(error) ? Number(error.response?.headers?.['retry-after']) : Number.NaN;
  if (!(Number.isFinite(wait) && wait > 0))
    return 'Too many wrong codes, so codes are paused. Try again later. If they are still refused, restore access on the server with the owner recovery command.';
  return wait <= 60
    ? 'Too many attempts. Wait a minute and try again.'
    : `Too many attempts. Wait ${Math.ceil(wait / 60)} minutes and try again.`;
}
