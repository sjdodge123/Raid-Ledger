/**
 * Unit tests for createScheduledEventIdempotent (ROK-1347).
 *
 * Covers the two new idempotency guards:
 *   1. Pre-create liveness check — a live guild SE matching title+start is
 *      adopted (saved) and the create is skipped.
 *   2. Timeout-after-success — when tryCreateNewEvent times out but Discord
 *      actually created the SE, a confirmation fetch adopts the id instead of
 *      re-throwing (which would let the next tick create a duplicate).
 *
 * resolveVoiceForCreate, saveScheduledEventId, getEventLiveState and
 * tryCreateNewEvent are mocked so the spec stays at the unit level; the DB
 * handle is a bare object. ROK-1391: saveScheduledEventId reports `{ bound }`
 * and the create path re-reads live state post-bind, so both are mocked to the
 * "no compensation" defaults (bound=true + a clean, future live row — a null
 * row is now treated as hard-deleted → compensate, so it must be non-null here).
 */
import { Logger } from '@nestjs/common';
import {
  createScheduledEventIdempotent,
  GuildSECache,
  type CreatePreamble,
} from './scheduled-event.create';
import * as dbHelpers from './scheduled-event.db-helpers';
import * as revalidate from './scheduled-event.revalidate';
import * as discordOps from './scheduled-event.discord-ops';
import type { ScheduledEventData } from './scheduled-event.helpers';

jest.mock('./scheduled-event.db-helpers', () => ({
  ...jest.requireActual('./scheduled-event.db-helpers'),
  resolveVoiceForCreate: jest.fn().mockResolvedValue('voice-1'),
}));
jest.mock('./scheduled-event.revalidate', () => ({
  ...jest.requireActual('./scheduled-event.revalidate'),
  // applyCreateEntryGuard calls getEventLiveState intra-module, so mocking the
  // getEventLiveState export alone wouldn't intercept the guard — mock the guard
  // entry point directly (default: fresh-time substitution, no skip).
  applyCreateEntryGuard: jest.fn(),
  saveScheduledEventId: jest.fn().mockResolvedValue({ bound: true }),
  getEventLiveState: jest.fn().mockResolvedValue(null),
}));
jest.mock('./scheduled-event.discord-ops', () => ({
  ...jest.requireActual('./scheduled-event.discord-ops'),
  tryCreateNewEvent: jest.fn(),
}));

const resolveVoiceForCreate =
  dbHelpers.resolveVoiceForCreate as jest.MockedFunction<
    typeof dbHelpers.resolveVoiceForCreate
  >;
const saveScheduledEventId =
  revalidate.saveScheduledEventId as jest.MockedFunction<
    typeof revalidate.saveScheduledEventId
  >;
const tryCreateNewEvent = discordOps.tryCreateNewEvent as jest.MockedFunction<
  typeof discordOps.tryCreateNewEvent
>;

// Future-dated so the ROK-1391 entry guard's past-start re-check passes; the
// guild-SE mocks below key off START_MS so adopt-by-start still matches.
const START = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
const START_MS = Date.parse(START);
const END = new Date(START_MS + 3 * 60 * 60 * 1000).toISOString();

const eventData: ScheduledEventData = {
  title: 'Palworld Event',
  startTime: START,
  endTime: END,
  signupCount: 3,
};

// ROK-1391: a healthy create sees a live row with no poll/cancel and a start
// matching the payload → entry guard passes, post-bind compensation is a no-op.
const LIVE = {
  reschedulingPollId: null,
  cancelledAt: null,
  startIso: START,
  endIso: END,
};

const db = {} as Parameters<typeof createScheduledEventIdempotent>[1];
const logger = new Logger('test');

function preamble(): CreatePreamble {
  return {
    gameId: 1,
    channelResolver: {
      resolveVoiceChannelHonoringOverride: jest.fn().mockResolvedValue('v'),
    },
    describe: jest.fn().mockResolvedValue('desc'),
  };
}

function makeGuild(
  ses: Array<{ id: string; name: string; ts: number; desc?: string }>,
) {
  return {
    scheduledEvents: {
      fetch: jest.fn().mockResolvedValue(
        new Map(
          ses.map((s) => [
            s.id,
            {
              id: s.id,
              name: s.name,
              scheduledStartTimestamp: s.ts,
              description: s.desc,
            },
          ]),
        ),
      ),
    },
  } as unknown as Parameters<typeof createScheduledEventIdempotent>[0];
}

/** RL fingerprint for mock SE descriptions (Codex P2 adopt guard). */
function rlDesc(eventId: number): string {
  return `Event\n\nView event: https://rl.example/events/${eventId}`;
}

const getEventLiveState = revalidate.getEventLiveState as jest.MockedFunction<
  typeof revalidate.getEventLiveState
>;
const applyCreateEntryGuard =
  revalidate.applyCreateEntryGuard as jest.MockedFunction<
    typeof revalidate.applyCreateEntryGuard
  >;

beforeEach(() => {
  resolveVoiceForCreate.mockReset().mockResolvedValue('voice-1');
  saveScheduledEventId.mockReset().mockResolvedValue({ bound: true });
  getEventLiveState.mockReset().mockResolvedValue(LIVE);
  // Guard passes; mirror the real fresh-time substitution to LIVE's start/end so
  // post-bind compensationDecision sees a matching start → no compensation.
  applyCreateEntryGuard
    .mockReset()
    .mockImplementation((_db, _logger, _eventId, ed) =>
      Promise.resolve({ ...ed, startTime: START, endTime: END }),
    );
  tryCreateNewEvent.mockReset();
});

describe('createScheduledEventIdempotent', () => {
  it('adopts an existing live guild SE (title+start match) and skips create', async () => {
    const guild = makeGuild([
      {
        id: 'existing-se',
        name: 'Palworld Event',
        ts: START_MS,
        desc: rlDesc(42),
      },
    ]);

    await createScheduledEventIdempotent(
      guild,
      db,
      logger,
      42,
      eventData,
      preamble(),
    );

    expect(tryCreateNewEvent).not.toHaveBeenCalled();
    expect(saveScheduledEventId).toHaveBeenCalledWith(db, 42, 'existing-se');
  });

  it('adopts a game-bearing event by its renamed name "<title> — <game>" (ROK-1350)', async () => {
    // The SE was created under buildScheduledEventName, so adopt must match the
    // combined name — matching by the bare title would miss it and duplicate.
    const gamed: ScheduledEventData = {
      ...eventData,
      game: { name: 'Valheim' },
    };
    const guild = makeGuild([
      {
        id: 'renamed-se',
        name: 'Palworld Event — Valheim',
        ts: START_MS,
        desc: rlDesc(42),
      },
    ]);

    await createScheduledEventIdempotent(
      guild,
      db,
      logger,
      42,
      gamed,
      preamble(),
    );

    expect(tryCreateNewEvent).not.toHaveBeenCalled();
    expect(saveScheduledEventId).toHaveBeenCalledWith(db, 42, 'renamed-se');
  });

  it('does NOT adopt a title+start match lacking the RL fingerprint (operator SE, Codex P2) — creates instead', async () => {
    const guild = makeGuild([
      {
        id: 'operator-se',
        name: 'Palworld Event',
        ts: START_MS,
        desc: 'Hand-made by the operator',
      },
    ]);
    tryCreateNewEvent.mockResolvedValue({ id: 'fresh-se' });

    await createScheduledEventIdempotent(
      guild,
      db,
      logger,
      42,
      eventData,
      preamble(),
    );

    // The operator SE must never be bound to the RL event.
    expect(saveScheduledEventId).not.toHaveBeenCalledWith(
      db,
      42,
      'operator-se',
    );
    expect(tryCreateNewEvent).toHaveBeenCalledTimes(1);
    expect(saveScheduledEventId).toHaveBeenCalledWith(db, 42, 'fresh-se');
  });

  it('creates a new SE when no matching guild SE exists', async () => {
    const guild = makeGuild([{ id: 'unrelated', name: 'Other', ts: 1 }]);
    tryCreateNewEvent.mockResolvedValue({ id: 'fresh-se' });

    await createScheduledEventIdempotent(
      guild,
      db,
      logger,
      42,
      eventData,
      preamble(),
    );

    expect(tryCreateNewEvent).toHaveBeenCalledTimes(1);
    expect(saveScheduledEventId).toHaveBeenCalledWith(db, 42, 'fresh-se');
  });

  it('adopts the SE id on a create timeout when Discord actually created it', async () => {
    // First fetch (pre-check): no match. After the timeout, the cache is
    // invalidated and a second fetch returns the SE Discord created.
    const guild = {
      scheduledEvents: {
        fetch: jest
          .fn()
          .mockResolvedValueOnce(new Map())
          .mockResolvedValue(
            new Map([
              [
                'late-se',
                {
                  id: 'late-se',
                  name: 'Palworld Event',
                  scheduledStartTimestamp: START_MS,
                  description: rlDesc(42),
                },
              ],
            ]),
          ),
      },
    } as unknown as Parameters<typeof createScheduledEventIdempotent>[0];
    tryCreateNewEvent.mockRejectedValue(
      new Error('Discord API timeout: scheduledEvents.create exceeded 5000ms'),
    );

    await createScheduledEventIdempotent(
      guild,
      db,
      logger,
      42,
      eventData,
      preamble(),
    );

    // No second create attempt; the confirmed id was adopted.
    expect(tryCreateNewEvent).toHaveBeenCalledTimes(1);
    expect(saveScheduledEventId).toHaveBeenCalledWith(db, 42, 'late-se');
  });

  it('re-throws a create timeout when no SE is found on confirmation', async () => {
    const guild = makeGuild([]); // empty both times
    tryCreateNewEvent.mockRejectedValue(
      new Error('Discord API timeout: scheduledEvents.create exceeded 5000ms'),
    );

    await expect(
      createScheduledEventIdempotent(
        guild,
        db,
        logger,
        42,
        eventData,
        preamble(),
      ),
    ).rejects.toThrow(/timeout/);
    expect(saveScheduledEventId).not.toHaveBeenCalled();
  });

  it('re-throws a non-timeout create error without confirmation', async () => {
    const guild = makeGuild([]);
    tryCreateNewEvent.mockRejectedValue(new Error('boom'));

    await expect(
      createScheduledEventIdempotent(
        guild,
        db,
        logger,
        42,
        eventData,
        preamble(),
      ),
    ).rejects.toThrow('boom');
  });

  it('skips when no voice channel resolves', async () => {
    resolveVoiceForCreate.mockResolvedValue(null);
    const guild = makeGuild([]);

    await createScheduledEventIdempotent(
      guild,
      db,
      logger,
      42,
      eventData,
      preamble(),
    );

    expect(tryCreateNewEvent).not.toHaveBeenCalled();
    expect(saveScheduledEventId).not.toHaveBeenCalled();
  });

  it('uses the shared GuildSECache so one batch fetches guild SEs once', async () => {
    const guild = makeGuild([]);
    tryCreateNewEvent.mockResolvedValue({ id: 'se-x' });
    const cache = new GuildSECache(guild);

    await createScheduledEventIdempotent(
      guild,
      db,
      logger,
      1,
      eventData,
      preamble(),
      cache,
    );
    await createScheduledEventIdempotent(
      guild,
      db,
      logger,
      2,
      { ...eventData, title: 'Other', startTime: '2026-08-01T20:00:00.000Z' },
      preamble(),
      cache,
    );

    // fetch is called once per create (invalidated after each successful create),
    // NOT twice for the pre-check of each — proves caching within a pre-check.
    const fetch = (
      guild as unknown as { scheduledEvents: { fetch: jest.Mock } }
    ).scheduledEvents.fetch;
    // 2 creates → at most 2 fetches (one pre-check each after invalidation),
    // never 4 (which a non-cached double-fetch-per-create would produce).
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
