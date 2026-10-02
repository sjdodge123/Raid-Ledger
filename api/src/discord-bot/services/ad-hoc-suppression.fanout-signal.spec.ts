/**
 * ROK-1696 — a suppressed Quick Play join that writes `extended_until` past the
 * scheduled end signals the shared end-time fan-out.
 *
 * The suppression helpers hold no service references: `suppressScheduled`
 * calls an optional `onExtended` hook, and `AdHocEventService` turns that hook
 * into `SUPPRESSION_WINDOW_EVENTS.EXTENDED` on EventEmitter2, which
 * `EventAutoExtendService` handles.
 *
 * Regression: ROK-1696
 */
import type { EventEmitter2 } from '@nestjs/event-emitter';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import * as helpers from './ad-hoc-event.helpers';
import { suppressScheduled } from './ad-hoc-suppression.helpers';
import {
  SUPPRESSION_WINDOW_EVENTS,
  type SuppressionWindowExtendedPayload,
} from './suppression-window-events';
import {
  baseMember,
  baseBinding,
  setupAdHocTestModule,
} from './ad-hoc-event.service.spec-helpers';

const MIN = 60_000;
const DISCORD_SE_ID = 'discord-se-77';

/** A live scheduled-event projection, offsets in minutes from now. */
function scheduledEvent(endInMin: number, extendedInMin: number | null) {
  return {
    id: 77,
    extendedUntil:
      extendedInMin === null
        ? null
        : new Date(Date.now() + extendedInMin * MIN),
    scheduledEnd: new Date(Date.now() + endInMin * MIN),
    matchedBy: 'game' as const,
    discordScheduledEventId: DISCORD_SE_ID,
  };
}

describe('suppressScheduled — onExtended hook (ROK-1696)', () => {
  let db: MockDb;
  let findSpy: jest.SpyInstance;

  beforeEach(() => {
    db = createDrizzleMock();
    findSpy = jest.spyOn(helpers, 'findActiveScheduledEvent');
  });

  afterEach(() => findSpy.mockRestore());

  function run(hook: jest.Mock): Promise<boolean> {
    return suppressScheduled(db as never, 'binding-A', 10, 'voice-1', hook);
  }

  it('calls the hook once with the written end when it lands past the scheduled end', async () => {
    findSpy.mockResolvedValueOnce(scheduledEvent(30, null));
    db.returning.mockResolvedValueOnce([{ id: 77 }]);
    const hook = jest.fn();
    const before = Date.now();

    await expect(run(hook)).resolves.toBe(true);

    expect(hook).toHaveBeenCalledTimes(1);
    const payload = hook.mock.calls[0][0] as SuppressionWindowExtendedPayload;
    expect(payload).toEqual({
      eventId: 77,
      newEnd: expect.any(Date),
      discordScheduledEventId: DISCORD_SE_ID,
    });
    // The payload carries exactly the value written to extended_until.
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({ extendedUntil: payload.newEnd }),
    );
    expect(payload.newEnd.getTime()).toBeGreaterThanOrEqual(before + 60 * MIN);
  });

  it.each([
    ['skip-fresh', 30, 40],
    ['skip-capped', -350, 10],
    ['skip-within-schedule', 120, null],
  ])('does not call the hook on %s (no write)', async (_label, end, ext) => {
    findSpy.mockResolvedValueOnce(scheduledEvent(end, ext));
    const hook = jest.fn();

    await expect(run(hook)).resolves.toBe(true);

    expect(db.update).not.toHaveBeenCalled();
    expect(hook).not.toHaveBeenCalled();
  });

  it('does not call the hook when the guarded write touches 0 rows', async () => {
    findSpy.mockResolvedValueOnce(scheduledEvent(30, null));
    db.returning.mockResolvedValueOnce([]);
    const hook = jest.fn();

    await expect(run(hook)).resolves.toBe(true);

    expect(db.update).toHaveBeenCalled();
    expect(hook).not.toHaveBeenCalled();
  });

  it('still suppresses (returns true) when the hook throws', async () => {
    findSpy.mockResolvedValueOnce(scheduledEvent(30, null));
    db.returning.mockResolvedValueOnce([{ id: 77 }]);
    const hook = jest.fn(() => {
      throw new Error('listener exploded');
    });

    await expect(run(hook)).resolves.toBe(true);

    expect(hook).toHaveBeenCalledTimes(1);
  });
});

describe('AdHocEventService — suppression window signal (ROK-1696)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('emits SUPPRESSION_WINDOW_EVENTS.EXTENDED on a suppressed join that writes', async () => {
    const { service, mocks } = await setupAdHocTestModule();
    mocks.settingsService.get.mockResolvedValue('true');
    jest
      .spyOn(helpers, 'findActiveScheduledEvent')
      .mockResolvedValueOnce(scheduledEvent(30, null));
    mocks.db.returning.mockResolvedValueOnce([{ id: 77 }]);
    // The real EventEmitter2 the spec helpers provide to the service.
    const emitter = (service as unknown as { eventEmitter: EventEmitter2 })
      .eventEmitter;
    const received: SuppressionWindowExtendedPayload[] = [];
    emitter.on(
      SUPPRESSION_WINDOW_EVENTS.EXTENDED,
      (p: SuppressionWindowExtendedPayload) => received.push(p),
    );

    const spawned = await service.handleVoiceJoin(
      'binding-A',
      baseMember,
      { ...baseBinding, gameId: 10 },
      undefined,
      undefined,
      'voice-1',
    );

    expect(spawned).toBe(false);
    expect(mocks.db.insert).not.toHaveBeenCalled();
    expect(received).toEqual([
      {
        eventId: 77,
        newEnd: expect.any(Date),
        discordScheduledEventId: DISCORD_SE_ID,
      },
    ]);
  });

  it('emits through ensureNotSuppressed too, and not when the join is within schedule', async () => {
    const { service } = await setupAdHocTestModule();
    const spy = jest.spyOn(helpers, 'findActiveScheduledEvent');
    spy.mockResolvedValueOnce(scheduledEvent(120, null));
    const emitter = (service as unknown as { eventEmitter: EventEmitter2 })
      .eventEmitter;
    const received: SuppressionWindowExtendedPayload[] = [];
    emitter.on(
      SUPPRESSION_WINDOW_EVENTS.EXTENDED,
      (p: SuppressionWindowExtendedPayload) => received.push(p),
    );

    await expect(
      service.ensureNotSuppressed('binding-A', 10, 'voice-1'),
    ).resolves.toBeNull();

    expect(received).toEqual([]);
  });
});
