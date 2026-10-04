import { describe, expect, it } from 'vitest';
import { errorMatchesShownJournal, journalChanged, matchesShownJournal } from './journal-revision';

const account = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('analytics reads against the shown journal revision', () => {
  it('keeps a read requested and shown at the same revision', () => {
    expect(matchesShownJournal(3, 3, 3)).toBe(true);
    expect(matchesShownJournal(null, 3, null)).toBe(true);
  });

  it('keeps a read requested while loading when computed at the revision that loaded', () => {
    expect(matchesShownJournal(null, 3, 3)).toBe(true);
    expect(matchesShownJournal(null, 2, 3)).toBe(false);
  });

  it('drops a read once a known journal revision changes', () => {
    expect(matchesShownJournal(3, 4, 4)).toBe(false);
    expect(matchesShownJournal(3, 3, 4)).toBe(false);
  });

  it('keeps an error from a request made while loading, never across a known change', () => {
    expect(errorMatchesShownJournal(null, 3)).toBe(true);
    expect(errorMatchesShownJournal(3, 3)).toBe(true);
    expect(errorMatchesShownJournal(3, 4)).toBe(false);
  });

  it('treats only an account switch or a known revision change as a journal change', () => {
    const at = (accountId: string, journalRevision: number | null) => ({
      accountId,
      journalRevision,
    });
    expect(journalChanged(at(account, null), at(account, 3))).toBe(false);
    expect(journalChanged(at(account, 3), at(account, 3))).toBe(false);
    expect(journalChanged(at(account, 3), at(account, 4))).toBe(true);
    expect(journalChanged(at(account, 3), at(account, null))).toBe(true);
    expect(journalChanged(at(account, null), at(other, null))).toBe(true);
  });
});
