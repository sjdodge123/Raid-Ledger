/**
 * ROK-2272 S6: the reschedule lock-in's `archiveOrLog` emits the carrier
 * lineup's `STATUS_CHANGED decided → archived` once, only after the archive
 * transaction committed — a failed archive is logged and emits nothing.
 */
import { createDrizzleMock } from '../../common/testing/drizzle-mock';
import { LINEUP_LIFECYCLE_EVENTS } from '../lineup-events.constants';
import { archiveOrLog } from './standalone-poll-reschedule-lock-in.helpers';

jest.mock('./standalone-poll-query.helpers', () => ({
  ...jest.requireActual('./standalone-poll-query.helpers'),
  clearReschedulingPollId: jest.fn().mockResolvedValue(undefined),
}));

const TARGET = {
  lineupId: 3,
  eventId: 55,
  eventCreatorId: 4,
  eventCancelled: false,
};

function build(): {
  db: ReturnType<typeof createDrizzleMock>;
  emit: jest.Mock;
  error: jest.Mock;
  run: () => Promise<void>;
} {
  const db = createDrizzleMock();
  const emit = jest.fn();
  const error = jest.fn();
  const deps = {
    db: db as never,
    eventsService: {} as never,
    notificationService: {} as never,
    logger: { error },
    events: { emit } as never,
  };
  return { db, emit, error, run: () => archiveOrLog(deps, 9, TARGET) };
}

describe('archiveOrLog — standalone archive emit (ROK-2272 S6)', () => {
  it('emits decided → archived once after the archive commits', async () => {
    const { db, emit, error, run } = build();
    await run();
    expect(emit.mock.calls).toEqual([
      [
        LINEUP_LIFECYCLE_EVENTS.STATUS_CHANGED,
        { lineupId: 3, from: 'decided', to: 'archived', standalone: true },
      ],
    ]);
    expect(db.set).toHaveBeenCalledWith({ status: 'archived' });
    expect(db.transaction.mock.invocationCallOrder[0] ?? Infinity).toBeLessThan(
      emit.mock.invocationCallOrder[0] ?? -Infinity,
    );
    expect(error).not.toHaveBeenCalled();
  });

  it('logs and emits nothing when the archive transaction fails', async () => {
    const { db, emit, error, run } = build();
    db.transaction.mockRejectedValueOnce(new Error('db down'));
    await expect(run()).resolves.toBeUndefined();
    expect(emit).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
  });
});
