import { isAxiosError } from 'axios';

/** A fixed sentence, or one built from the server's own message when it sent one. */
type Reply = string | ((serverMessage: string | undefined) => string);

/**
 * The sentence the owner reads when a request fails: no answer from the server first, then the
 * answer for the HTTP status, then the fallback.
 */
export function requestFailure(
  error: unknown,
  texts: { unreachable: string; fallback: string; status?: Partial<Record<number, Reply>> },
): string {
  if (!isAxiosError(error) || error.response === undefined) return texts.unreachable;
  const reply = texts.status?.[error.response.status];
  if (reply === undefined) return texts.fallback;
  if (typeof reply === 'string') return reply;
  const body = error.response.data as { message?: unknown } | undefined;
  return reply(typeof body?.message === 'string' ? body.message : undefined);
}
