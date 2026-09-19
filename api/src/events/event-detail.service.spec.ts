/**
 * ROK-1189 item 3 — the conflict enrichment belongs in the bundle's parallel
 * batch, not behind it.
 *
 * `findDetail` used to await the 4-lookup `Promise.all` and only then run
 * `enrichEventWithConflicts`, costing one serial round-trip on every event
 * detail request even though the enrichment only needs the event + userId.
 *
 * The test below gates every lookup on a deferred that is resolved by hand, so
 * "did the conflict query start before the roster finished?" is an observable
 * fact rather than a timing guess. Revert the service to the sequential form
 * and `conflictStarted` is still false at the assertion — the batch can never
 * settle because nothing has resolved yet.
 */
import { EventDetailService } from './event-detail.service';
import type { EventResponseDto } from '@raid-ledger/contract';

/** A promise plus the trigger that settles it. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const EVENT = {
  id: 42,
  title: 'Karazhan',
  startTime: '2026-09-19T20:00:00.000Z',
  endTime: '2026-09-19T23:00:00.000Z',
  game: { id: 7 },
  recurrenceGroupId: null,
  ephemeralVoiceChannelId: null,
  notificationChannelOverride: null,
} as unknown as EventResponseDto;

describe('EventDetailService.findDetail', () => {
  it('starts the conflict enrichment in parallel with the other lookups', async () => {
    const roster = deferred<unknown>();
    const assignments = deferred<unknown>();
    const pugs = deferred<{ pugs: unknown[] }>();
    const conflicts = deferred<unknown[]>();

    let conflictStarted = false;

    const eventsService = { findOne: jest.fn().mockResolvedValue(EVENT) };
    const signupsService = {
      getRoster: jest.fn().mockReturnValue(roster.promise),
      getRosterWithAssignments: jest
        .fn()
        .mockReturnValue(assignments.promise),
    };
    const pugsService = { findAll: jest.fn().mockReturnValue(pugs.promise) };
    const channelResolverService = {
      resolveVoiceChannelHonoringOverride: jest.fn().mockResolvedValue(null),
    };
    const discordBotClientService = {
      getGuildId: jest.fn().mockReturnValue(null),
      getClient: jest.fn().mockReturnValue(null),
    };
    // The conflict query is reached through the drizzle handle, so the mock
    // mirrors `findConflictingEvents`'s chain
    // (select → from → innerJoin → where) and hands back the deferred.
    const db = {
      select: jest.fn().mockImplementation(() => {
        conflictStarted = true;
        return {
          from: () => ({
            innerJoin: () => ({ where: () => conflicts.promise }),
          }),
        };
      }),
    };

    const service = new EventDetailService(
      db as never,
      eventsService as never,
      signupsService as never,
      pugsService as never,
      channelResolverService as never,
      discordBotClientService as never,
    );

    // userId must be non-null or the enrichment short-circuits before querying.
    const pending = service.findDetail(42, 99);

    // Let the synchronous part of the batch run. Nothing has resolved yet.
    await Promise.resolve();
    await Promise.resolve();

    expect(signupsService.getRoster).toHaveBeenCalled();
    expect(conflictStarted).toBe(true);

    roster.resolve([]);
    assignments.resolve([]);
    pugs.resolve({ pugs: [] });
    conflicts.resolve([]);

    const result = await pending;
    expect(result.event.id).toBe(42);
  });
});
