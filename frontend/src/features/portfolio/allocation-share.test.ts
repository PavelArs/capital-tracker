import { describe, expect, it } from 'vitest';
import { shareText } from './Allocation';

describe('ALLOC-SHARE a held slice too small for two decimals is not shown as nothing', () => {
  it('ALLOC-SHARE shows a share above 0 that rounds to 0.00% as <0.01%', () => {
    expect(shareText('0.004')).toBe('<0.01%');
    expect(shareText('0.005')).toBe('<0.01%');
    expect(shareText('0.0000001')).toBe('<0.01%');
  });

  it('ALLOC-SHARE keeps 0, missing and every share that shows a hundredth as they are', () => {
    expect(shareText('0')).toBe('0.00%');
    expect(shareText(null)).toBe('—');
    expect(shareText('0.01')).toBe('0.01%');
    expect(shareText('0.019')).toBe('0.01%');
    expect(shareText('42.1')).toBe('42.10%');
  });

  it('DASH-LAYOUT shows one decimal on request, rounded down, and <0.1% for a held sliver', () => {
    expect(shareText('62.49', 1)).toBe('62.4%');
    expect(shareText('42', 1)).toBe('42.0%');
    expect(shareText('0.04', 1)).toBe('<0.1%');
    expect(shareText('0', 1)).toBe('0.0%');
    expect(shareText(null, 1)).toBe('—');
  });
});
