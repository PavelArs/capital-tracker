import { generationNow, outdateReads } from '@api/read-cache';
import { describe, expect, it } from 'vitest';
import { handOver, takeHandover } from './proposals-handover';

describe('proposal cards handed over by the page', () => {
  it('hands over an answer asked since the last sync, once', () => {
    handOver('transfer', generationNow());
    expect(takeHandover('transfer')).toBe(true);
    expect(takeHandover('transfer')).toBe(false);
  });

  it('does not hand over an answer asked before a background sync landed', () => {
    const asked = generationNow();
    outdateReads();
    // The answer was not kept, so the card would paint the one from before the sync.
    handOver('duplicate', asked);
    expect(takeHandover('duplicate')).toBe(false);
  });
});
