import { isAxiosError } from 'axios';

/**
 * What to say after a 429 on a sign-in or security code. The per-address request limit sends
 * Retry-After (60 seconds at most); the owner's ten-minute code cooldown sends none.
 */
export function tooManyAttempts(error: unknown): string {
  const wait = isAxiosError(error) ? Number(error.response?.headers?.['retry-after']) : Number.NaN;
  return Number.isFinite(wait) && wait > 0 && wait <= 60
    ? 'Too many attempts. Wait a minute and try again.'
    : 'Too many attempts. Wait 10 minutes and try again.';
}
