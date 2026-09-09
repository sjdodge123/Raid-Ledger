/**
 * ROK-1494 review §3 (Q4) — the reaper is the END of an LFG-born session.
 *
 * The claim pinned here is narrow and load-bearing: `finalizeAll` is a single
 * bulk UPDATE that deliberately bypasses `markLeave`, so NO `PARTICIPANT_LEFT`
 * is emitted when the reaper ends an event. For a Quick Play event that is
 * fine — nothing outside the event cares. For an LFG-born one it means nobody
 * ever tells `LfmEmbedService` the session is over, so the forum post reads
 * `▸ PLAYING NOW · N in voice` forever and its `lfg_group_messages` row stays
 * `open`, which holds the game hostage to `uq_lfg_group_messages_game_open`:
 * that game can never post another LFM message.
 *
 * So the two assertions that matter are symmetric — an LFG-born reap emits
 * EXACTLY ONE terminal `GROUP_CHANGED`, and an ordinary ad-hoc reap emits NONE.
 * A "just always emit" fix would pass the first and fail the second.
 */
import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { AdHocEventsGateway } from '../../events/ad-hoc-events.gateway';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { LFG_EVENTS } from '../../lfg/lfg.constants';
import { AdHocParticipantService } from './ad-hoc-participant.service';
import { AdHocReaperService } from './ad-hoc-reaper.service';
import * as eventHelpers from './ad-hoc-event.helpers';
import * as lfgNowStore from '../lfg-now/lfg-now.db-helpers';

jest.mock('./ad-hoc-event.helpers');
jest.mock('../lfg-now/lfg-now.db-helpers');

const EVENT_ID = 900;
const GAME_ID = 42;

const participantService = { finalizeAll: jest.fn() };
const gateway = { emitStatusChange: jest.fn() };
const cronJobService = {
  executeWithTracking: jest.fn((_name: string, fn: () => Promise<void>) =>
    fn(),
  ),
};

let service: AdHocReaperService;
let emitter: EventEmitter2;

/** An orphaned ad-hoc event row, as `findOrphanedAdHocEvents` returns it. */
function orphan(): typeof schema.events.$inferSelect {
  return { id: EVENT_ID, gameId: GAME_ID } as typeof schema.events.$inferSelect;
}

/** Every `GROUP_CHANGED` the reaper emitted during the run. */
function groupChanges(): unknown[] {
  return jest
    .mocked(emitter.emit)
    .mock.calls.filter(([name]) => name === LFG_EVENTS.GROUP_CHANGED)
    .map(([, payload]) => payload);
}

beforeEach(async () => {
  jest.clearAllMocks();
  const helpers = jest.mocked(eventHelpers);
  helpers.findOrphanedAdHocEvents.mockResolvedValue([orphan()]);
  helpers.forceClaimOrphanedEvent.mockResolvedValue(orphan());
  helpers.setEventEndTime.mockResolvedValue(undefined);
  participantService.finalizeAll.mockResolvedValue(undefined);
  // Default: NOT LFG-born. Every positive case opts in explicitly.
  jest.mocked(lfgNowStore).lfgSpawnedEventGameId.mockResolvedValue(null);

  const module = await Test.createTestingModule({
    providers: [
      AdHocReaperService,
      EventEmitter2,
      { provide: DrizzleAsyncProvider, useValue: {} },
      { provide: AdHocParticipantService, useValue: participantService },
      { provide: AdHocEventsGateway, useValue: gateway },
      { provide: CronJobService, useValue: cronJobService },
    ],
  }).compile();
  service = module.get(AdHocReaperService);
  emitter = module.get(EventEmitter2);
  jest.spyOn(emitter, 'emit');
});

describe('AdHocReaperService — ending an LFG-born session (ROK-1494 Q4)', () => {
  it('emits exactly one terminal GROUP_CHANGED for the game', async () => {
    jest.mocked(lfgNowStore).lfgSpawnedEventGameId.mockResolvedValue(GAME_ID);

    await service.reapOrphanedEvents();

    expect(groupChanges()).toEqual([
      { gameId: GAME_ID, reason: 'converted', eventId: EVENT_ID },
    ]);
  });

  it('emits it AFTER the event has been ended, never before', async () => {
    jest.mocked(lfgNowStore).lfgSpawnedEventGameId.mockResolvedValue(GAME_ID);
    const order: string[] = [];
    jest.mocked(eventHelpers).setEventEndTime.mockImplementation(() => {
      order.push('setEventEndTime');
      return Promise.resolve();
    });
    jest.spyOn(emitter, 'emit').mockImplementation((name: string | symbol) => {
      if (name === LFG_EVENTS.GROUP_CHANGED) order.push('GROUP_CHANGED');
      return true;
    });

    await service.reapOrphanedEvents();

    expect(order).toEqual(['setEventEndTime', 'GROUP_CHANGED']);
  });

  it('still reaps when the emit throws — the reaper must never be poisoned', async () => {
    jest
      .mocked(lfgNowStore)
      .lfgSpawnedEventGameId.mockRejectedValue(
        new Error('connection terminated'),
      );

    await expect(service.reapOrphanedEvents()).resolves.toBeUndefined();
    expect(gateway.emitStatusChange).toHaveBeenCalledWith(EVENT_ID, 'ended');
  });
});

describe('AdHocReaperService — an ordinary ad-hoc event (the negative)', () => {
  it('emits NO GROUP_CHANGED for a binding-born Quick Play event', async () => {
    await service.reapOrphanedEvents();

    expect(groupChanges()).toEqual([]);
    expect(gateway.emitStatusChange).toHaveBeenCalledWith(EVENT_ID, 'ended');
  });

  it('emits nothing at all when the event could not be claimed', async () => {
    jest.mocked(lfgNowStore).lfgSpawnedEventGameId.mockResolvedValue(GAME_ID);
    jest.mocked(eventHelpers).forceClaimOrphanedEvent.mockResolvedValue(null);

    await service.reapOrphanedEvents();

    expect(groupChanges()).toEqual([]);
    expect(participantService.finalizeAll).not.toHaveBeenCalled();
  });
});
