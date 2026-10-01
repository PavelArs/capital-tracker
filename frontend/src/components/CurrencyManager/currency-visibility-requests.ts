// Only the pending HTTP command survives a Settings remount, never private rows.
let pending: Promise<void> | null = null;

export function runCurrencyVisibilityCommand(operation: () => Promise<unknown>): Promise<void> {
  if (pending) return Promise.reject(new Error('Currency visibility command already pending'));
  // Reserve synchronously before the operation can invoke another command.
  const request = Promise.resolve()
    .then(operation)
    .then(() => undefined);
  pending = request;
  const release = () => {
    if (pending === request) pending = null;
  };
  void request.then(release, release);
  return request;
}

export async function waitForCurrencyVisibilityCommand(): Promise<void> {
  while (pending) {
    // Reconcile with fresh reads regardless of the previous caller's outcome.
    await pending.catch(() => undefined);
  }
}
