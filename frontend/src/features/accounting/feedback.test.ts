import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useAttempt } from './feedback';

describe('useAttempt', () => {
  it('keeps one id per pending command until it is done', () => {
    const attempt = renderHook(() => useAttempt()).result.current;
    const first = attempt(['a', { amount: '1' }]);
    const second = attempt(['b', { amount: '1' }]);
    expect(second).not.toBe(first);
    expect(attempt(['a', { amount: '1' }])).toBe(first);
    attempt.done(['a', { amount: '1' }]);
    expect(attempt(['a', { amount: '1' }])).not.toBe(first);
    expect(attempt(['b', { amount: '1' }])).toBe(second);
  });
});
