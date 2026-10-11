const WINDOW_MS = 10 * 60 * 1000;
const WINDOW_LIMIT = 10;
// Failures since the last success. Paced guessing below the window cooldown still
// ends here; only a successful factor, re-enrollment or CLI recovery clears it.
export const MFA_STREAK_LIMIT = 100;

export interface FailureState {
  failedAttempts: number;
  failureWindowStart: Date | null;
  blockedUntil: Date | null;
  consecutiveFailures: number;
}

export function streakLocked(state: Pick<FailureState, 'consecutiveFailures'>): boolean {
  return state.consecutiveFailures >= MFA_STREAK_LIMIT;
}

export function recordFailure(
  state: FailureState,
  now: Date,
): { next: FailureState; status: 401 | 429 } {
  const currentWindow =
    state.failureWindowStart !== null &&
    now.getTime() - state.failureWindowStart.getTime() < WINDOW_MS &&
    !state.blockedUntil;
  const failures = currentWindow ? state.failedAttempts + 1 : 1;
  const next = {
    failedAttempts: failures,
    failureWindowStart: currentWindow ? state.failureWindowStart : now,
    blockedUntil: failures >= WINDOW_LIMIT ? new Date(now.getTime() + WINDOW_MS) : null,
    consecutiveFailures: Math.min(state.consecutiveFailures + 1, MFA_STREAK_LIMIT),
  };
  return { next, status: failures >= WINDOW_LIMIT || streakLocked(next) ? 429 : 401 };
}
