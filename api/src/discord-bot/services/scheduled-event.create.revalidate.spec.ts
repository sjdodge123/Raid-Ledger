/**
 * ROK-1391 — reschedule-poll lock-in race (TDD, RED-first).
 *
 * These deterministic race specs pin the create-time revalidation contract:
 *  - entry guard (skip on an open reschedule poll / cancellation, substitute the
 *    fresh row time over a drifted payload),
 *  - conditional bind (`saveScheduledEventId` reports whether the bind took),
 *  - post-bind compensation (delete + conditionally clear a stale-payload SE).
 *
 * Every case fails against current `main` code (no guard, unconditional save, no
 * compensation). Interleaving is driven ONLY by manually-resolved deferred
 * promises + mock-time state flips — ZERO timers, ZERO sleep.
 *
 * Reuses `setupScheduledEventTestModule` / `createMockGuild` from
 * `scheduled-event.service.spec-helpers.ts`.
 */
import {
  setupScheduledEventTestModule,
  baseEventData,
  FUTURE,
  FUTURE_END,
  type ScheduledEventMocks,
} from './scheduled-event.service.spec-helpers';

/** A tiny manually-resolved deferred promise (no timers). */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * Combined events-row snapshot: one mutable object every mocked SELECT resolves
 * to. `getScheduledEventId`, `getEventLiveState` and `getRecurrenceAndEphemeral`
 * each read the fields they care about, so a single row serves all reads and
 * flipping a field mid-flight models a concurrent poll-start stamp.
 */
interface LiveRow {
  discordScheduledEventId: string | null;
  reschedulingPollId: string | null;
  cancelledAt: string | null;
  startIso: string;
  endIso: string;
  recurrenceGroupId: string | null;
  ephemeralVoiceChannelId: string | null;
}

function makeLive(overrides: Partial<LiveRow> = {}): LiveRow {
  return {
    discordScheduledEventId: null,
    reschedulingPollId: null,
    cancelledAt: null,
    startIso: FUTURE.toISOString(),
    endIso: FUTURE_END.toISOString(),
    recurrenceGroupId: null,
    ephemeralVoiceChannelId: null,
    ...overrides,
  };
}

/**
 * Conditional-UPDATE mock: `.set().where().returning()` resolves `returningRows`
 * (the `.returning()` of the new conditional `saveScheduledEventId`), while an
 * awaited `.where()` (the conditional clear) resolves undefined. `returningRows`
 * empty ⇒ the bind matched 0 rows ⇒ `{ bound: false }`.
 */
function makeUpdate(returningRows: unknown[]) {
  const returning = jest.fn().mockResolvedValue(returningRows);
  const set = jest.fn();
  const where = jest.fn();
  const chain = { set, where } as Record<string, jest.Mock>;
  const whereResult = Promise.resolve(undefined) as Promise<undefined> & {
    returning: jest.Mock;
  };
  whereResult.returning = returning;
  set.mockReturnValue(chain);
  where.mockReturnValue(whereResult);
  return { chain, set, where, returning };
}

describe('createScheduledEvent — create-time revalidation (ROK-1391)', () => {
  let mocks: ScheduledEventMocks;

  beforeEach(async () => {
    mocks = await setupScheduledEventTestModule();
  });

  afterEach(() => jest.clearAllMocks());

  function armDb(live: LiveRow, returningRows: unknown[] = [{ id: 42 }]) {
    mocks.mockDb.select.mockReturnValue(mocks.createSelectChain([live]));
    return makeUpdate(returningRows);
  }

  it('T1: skips the create — and never runs the adopt fetch — when the reschedule-poll flag is set', async () => {
    const u = armDb(makeLive({ reschedulingPollId: 'poll-1' }));
    mocks.mockDb.update.mockReturnValue(u.chain);

    await mocks.service.createScheduledEvent(
      42,
      { ...baseEventData },
      1,
      false,
    );

    expect(mocks.mockGuild.scheduledEvents.create).not.toHaveBeenCalled();
    // The entry guard short-circuits BEFORE the (root-cause) un-timed adopt fetch.
    expect(mocks.mockGuild.scheduledEvents.fetch).not.toHaveBeenCalled();
  });

  it('T2: a flag stamped during the create triggers post-bind compensation — deletes the created SE and clears its binding', async () => {
    const live = makeLive(); // clean at entry
    const u = armDb(live);
    mocks.mockDb.update.mockReturnValue(u.chain);

    const createCalled = deferred<void>();
    const createResult = deferred<{ id: string }>();
    mocks.mockGuild.scheduledEvents.create.mockImplementation(() => {
      createCalled.resolve();
      return createResult.promise;
    });

    const pending = mocks.service.createScheduledEvent(
      42,
      { ...baseEventData },
      1,
      false,
    );
    await createCalled.promise; // create is in-flight (entry guard already passed)
    live.reschedulingPollId = 'poll-2'; // poll-start stamps the flag concurrently
    createResult.resolve({ id: 'discord-se-id-1' });
    await pending;

    expect(mocks.mockGuild.scheduledEvents.delete).toHaveBeenCalledWith(
      'discord-se-id-1',
    );
    // Conditional clear of OUR binding (WHERE discord_scheduled_event_id = ours).
    expect(u.set).toHaveBeenCalledWith({ discordScheduledEventId: null });
  });

  it('T3: substitutes the fresh row start/end over a drifted payload before creating the SE', async () => {
    const freshStart = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const freshEnd = new Date(freshStart.getTime() + 2 * 60 * 60 * 1000);
    const u = armDb(
      makeLive({
        startIso: freshStart.toISOString(),
        endIso: freshEnd.toISOString(),
      }),
    );
    mocks.mockDb.update.mockReturnValue(u.chain);

    // Payload carries the STALE pre-reschedule time (baseEventData = FUTURE).
    await mocks.service.createScheduledEvent(
      42,
      { ...baseEventData },
      1,
      false,
    );

    expect(mocks.mockGuild.scheduledEvents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduledStartTime: freshStart,
        scheduledEndTime: freshEnd,
      }),
    );
  });

  it('T4: a conditional bind that matches 0 rows (a different SE won) compensating-deletes our created SE', async () => {
    const u = armDb(makeLive(), []); // live state clean → bind-loss is the sole trigger
    mocks.mockDb.update.mockReturnValue(u.chain);

    await mocks.service.createScheduledEvent(
      42,
      { ...baseEventData },
      1,
      false,
    );

    expect(u.returning).toHaveBeenCalled(); // conditional save uses .returning()
    expect(mocks.mockGuild.scheduledEvents.delete).toHaveBeenCalledWith(
      'discord-se-id-1',
    );
  });

  it('T5: aborts before any Discord SE is created when the event is cancelled at entry', async () => {
    const u = armDb(makeLive({ cancelledAt: new Date().toISOString() }));
    mocks.mockDb.update.mockReturnValue(u.chain);

    await mocks.service.createScheduledEvent(
      42,
      { ...baseEventData },
      1,
      false,
    );

    expect(mocks.mockGuild.scheduledEvents.create).not.toHaveBeenCalled();
  });
});
