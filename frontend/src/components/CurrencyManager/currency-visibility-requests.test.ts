import { describe, expect, it, vi } from 'vitest';
import {
  runCurrencyVisibilityCommand,
  waitForCurrencyVisibilityCommand,
} from './currency-visibility-requests';

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
}

describe('currency visibility command coordination', () => {
  it('reserves before invoking the operation and refuses a reentrant command without invoking it', async () => {
    const held = deferred();
    const duplicate = vi.fn(async () => undefined);
    let nested: Promise<void> | undefined;
    const operation = vi.fn(() => {
      nested = runCurrencyVisibilityCommand(duplicate);
      // Observe the rejection immediately, even if the operation starts on a microtask.
      void nested.catch(() => undefined);
      return held.promise;
    });
    const first = runCurrencyVisibilityCommand(operation);
    try {
      await Promise.resolve();
      expect(operation).toHaveBeenCalledTimes(1);
      expect(nested).toBeDefined();
      await expect(nested!).rejects.toBeInstanceOf(Error);
      expect(duplicate).not.toHaveBeenCalled();
    } finally {
      held.resolve();
      await first;
    }
    await expect(waitForCurrencyVisibilityCommand()).resolves.toBeUndefined();
  });

  it.each(['success', 'failure'] as const)(
    'waits for %s, releases the slot and permits an explicit new command without replay',
    async (outcome) => {
      const held = deferred();
      const failure = new Error('original command failed');
      const operation = vi.fn(() => held.promise);
      const first = runCurrencyVisibilityCommand(operation);
      void first.catch(() => undefined);
      const settled = vi.fn();
      const waiter = waitForCurrencyVisibilityCommand().then(settled);
      const duplicate = vi.fn(async () => undefined);
      try {
        await expect(runCurrencyVisibilityCommand(duplicate)).rejects.toBeInstanceOf(Error);
        expect(duplicate).not.toHaveBeenCalled();
        await Promise.resolve();
        expect(settled).not.toHaveBeenCalled();
        if (outcome === 'success') {
          held.resolve();
          await expect(first).resolves.toBeUndefined();
        } else {
          held.reject(failure);
          await expect(first).rejects.toBe(failure);
        }
        await waiter;
        expect(settled).toHaveBeenCalledTimes(1);
        const next = vi.fn(async () => 'new explicit operation');
        await expect(runCurrencyVisibilityCommand(next)).resolves.toBeUndefined();
        expect(next).toHaveBeenCalledTimes(1);
        expect(operation).toHaveBeenCalledTimes(1);
        expect(duplicate).not.toHaveBeenCalled();
      } finally {
        held.resolve();
        await first.catch(() => undefined);
        await waiter;
      }
    },
  );
});
