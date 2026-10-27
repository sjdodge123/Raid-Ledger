import { createDrizzleMock } from '../../common/testing/drizzle-mock';
import { startGracePeriod } from './ad-hoc-event-end.helpers';

type GraceDeps = Parameters<typeof startGracePeriod>[0];

function makeDeps(): {
  deps: GraceDeps;
  db: ReturnType<typeof createDrizzleMock>;
  enqueue: jest.Mock;
  emitStatusChange: jest.Mock;
} {
  const db = createDrizzleMock();
  const enqueue = jest.fn().mockResolvedValue(undefined);
  const emitStatusChange = jest.fn();
  const deps = {
    db,
    channelBindingsService: {
      getBindingById: jest
        .fn()
        .mockResolvedValue({ config: { gracePeriod: 3 } }),
    },
    gracePeriodQueue: { enqueue },
    gateway: { emitStatusChange },
  } as unknown as GraceDeps;
  return { deps, db, enqueue, emitStatusChange };
}

// TECH-DEBT 2026-10-22 (Lead session ag): the `live`-only guarded update can
// match no row (the session already ended or is already in grace), and the job
// was still enqueued and `grace_period` still broadcast. MUTATION: ignore the
// `setGracePeriodStatus` result and the "no row" case enqueues + emits again.
describe('startGracePeriod', () => {
  it('enqueues the job and emits grace_period when the live row flipped', async () => {
    const { deps, db, enqueue, emitStatusChange } = makeDeps();
    db.returning.mockResolvedValueOnce([{ id: 7 }]);
    await startGracePeriod(deps, 7, 'binding-1');
    expect(enqueue).toHaveBeenCalledWith(7, 3 * 60 * 1000);
    expect(emitStatusChange).toHaveBeenCalledWith(7, 'grace_period');
  });

  it('does neither when the guarded update matched no live row', async () => {
    const { deps, db, enqueue, emitStatusChange } = makeDeps();
    db.returning.mockResolvedValueOnce([]);
    await startGracePeriod(deps, 7, 'binding-1');
    expect(enqueue).not.toHaveBeenCalled();
    expect(emitStatusChange).not.toHaveBeenCalled();
  });
});
