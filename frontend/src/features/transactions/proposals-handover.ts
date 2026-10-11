// The page reads the proposal cards together with the list, so they are on screen when it
// appears; the cards then need not ask again. The hand-over is used once and only while it is
// fresh, so a later visit still revalidates as usual.
const HANDED_OVER_MS = 3000;
const handed = new Map<string, number>();

export type Proposals = 'transfer' | 'duplicate';

export function handOver(kind: Proposals): void {
  handed.set(kind, Date.now());
}

/** True once for an answer handed over a moment ago. */
export function takeHandover(kind: Proposals): boolean {
  const at = handed.get(kind);
  handed.delete(kind);
  return at !== undefined && Date.now() - at < HANDED_OVER_MS;
}
