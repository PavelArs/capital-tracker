import { FailureState, MFA_STREAK_LIMIT, recordFailure, streakLocked } from './mfa-failures';

const start = new Date('2026-10-07T12:00:00Z');
const minutes = (n: number) => new Date(start.getTime() + n * 60_000);
const fresh: FailureState = {
  failedAttempts: 0,
  failureWindowStart: null,
  blockedUntil: null,
  consecutiveFailures: 0,
};

describe('MFA-STREAK owner factor failure bookkeeping', () => {
  it('keeps the ten-failure window cooldown', () => {
    let state = fresh;
    let status = 401;
    for (let i = 0; i < 10; i += 1)
      ({ next: state, status } = recordFailure(state, minutes(i / 10)));
    expect(status).toBe(429);
    expect(state.failedAttempts).toBe(10);
    expect(state.blockedUntil).toEqual(new Date(minutes(0.9).getTime() + 10 * 60_000));
    expect(streakLocked(state)).toBe(false);
  });

  it('restarts the window count but not the streak after ten minutes', () => {
    const first = recordFailure(fresh, start).next;
    const later = recordFailure(first, minutes(11));
    expect(later.status).toBe(401);
    expect(later.next.failedAttempts).toBe(1);
    expect(later.next.failureWindowStart).toEqual(minutes(11));
    expect(later.next.consecutiveFailures).toBe(2);
  });

  it('locks the factor once paced guesses reach the streak limit', () => {
    let state = fresh;
    let status = 401;
    let failures = 0;
    // Nine guesses per eleven-minute window never reach the window cooldown.
    for (let window = 0; failures < MFA_STREAK_LIMIT; window += 1) {
      for (let i = 0; i < 9 && failures < MFA_STREAK_LIMIT; i += 1, failures += 1) {
        expect(streakLocked(state)).toBe(false);
        ({ next: state, status } = recordFailure(state, minutes(window * 11 + i / 10)));
      }
    }
    expect(state.blockedUntil).toBeNull();
    expect(status).toBe(429);
    expect(state.consecutiveFailures).toBe(MFA_STREAK_LIMIT);
    expect(streakLocked(state)).toBe(true);
    expect(recordFailure(state, minutes(5000)).next.consecutiveFailures).toBe(MFA_STREAK_LIMIT);
  });
});
