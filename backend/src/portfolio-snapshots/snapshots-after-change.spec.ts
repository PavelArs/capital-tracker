import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { PortfolioSnapshotsService } from './portfolio-snapshots.service';
import { SnapshotsAfterChangeInterceptor } from './snapshots-after-change.interceptor';

const OWNER = '11111111-1111-4111-8111-111111111111';

function service(enabled = true) {
  const config = { get: (key: string) => (key === 'PRICE_COLLECTION_ENABLED' ? `${enabled}` : '') };
  const snapshots = new PortfolioSnapshotsService({} as never, config as never);
  const refresh = jest.spyOn(snapshots, 'refresh').mockResolvedValue({ outcome: 'fresh' });
  return { snapshots, refresh };
}

describe('rebuilding snapshots in the background after a change', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('SNAP-SOON rebuilds once, shortly after the last of a burst of changes', () => {
    const { snapshots, refresh } = service();
    snapshots.refreshSoon(OWNER);
    jest.advanceTimersByTime(1_500);
    snapshots.refreshSoon(OWNER);
    jest.advanceTimersByTime(1_500);
    expect(refresh).not.toHaveBeenCalled();
    jest.advanceTimersByTime(600);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith(OWNER);
  });

  it('SNAP-SOON keeps owners apart and does nothing while price collection is off', () => {
    const { snapshots, refresh } = service();
    snapshots.refreshSoon(OWNER);
    snapshots.refreshSoon('22222222-2222-4222-8222-222222222222');
    jest.advanceTimersByTime(2_100);
    expect(refresh).toHaveBeenCalledTimes(2);

    const off = service(false);
    off.snapshots.refreshSoon(OWNER);
    jest.advanceTimersByTime(5_000);
    expect(off.refresh).not.toHaveBeenCalled();
  });

  it('SNAP-SOON survives a failed rebuild and stops its timers on shutdown', async () => {
    const { snapshots, refresh } = service();
    refresh.mockRejectedValueOnce(new Error('database down'));
    snapshots.refreshSoon(OWNER);
    jest.advanceTimersByTime(2_100);
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(1);

    snapshots.refreshSoon(OWNER);
    snapshots.onModuleDestroy();
    jest.advanceTimersByTime(5_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('SnapshotsAfterChangeInterceptor', () => {
  const run = async (method: string, user: unknown, result: CallHandler['handle']) => {
    const snapshots = { refreshSoon: jest.fn() };
    const interceptor = new SnapshotsAfterChangeInterceptor(snapshots as never);
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ method, user }) }),
    } as ExecutionContext;
    await lastValueFrom(interceptor.intercept(context, { handle: result }), {
      defaultValue: null,
    }).catch(() => undefined);
    return snapshots.refreshSoon;
  };

  it('asks for a rebuild after a successful write of a signed-in owner', async () => {
    const refreshSoon = await run('POST', { userId: OWNER }, () => of({ ok: true }));
    expect(refreshSoon).toHaveBeenCalledWith(OWNER);
  });

  it('leaves reads, failed writes and anonymous requests alone', async () => {
    expect(await run('GET', { userId: OWNER }, () => of(1))).not.toHaveBeenCalled();
    expect(
      await run('PATCH', { userId: OWNER }, () => throwError(() => new Error('rejected'))),
    ).not.toHaveBeenCalled();
    expect(await run('POST', undefined, () => of(1))).not.toHaveBeenCalled();
  });
});
