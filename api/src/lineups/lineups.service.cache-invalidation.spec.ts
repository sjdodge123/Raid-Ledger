/**
 * Lineups service — AI suggestions cache invalidation tests (TDD FAILING, ROK-931).
 *
 * Covers spec AC line 255 — "Cache invalidated on nominate / un-nominate /
 * invitee add / remove (unit test on service)" plus the planner's failure-
 * isolation requirement (spec §API changes, "Cache invalidation hooks"):
 * invalidation runs in a try/catch AFTER the parent mutation so a thrown
 * invalidator does NOT fail the parent.
 *
 * Implementation does not exist yet — the architect chose to extract an
 * `AiSuggestionsCacheInvalidator` provider (dev-brief item #3) and inject
 * it into `LineupsService`. These tests expect that provider and assert
 * `invalidateForLineup` is called after each of the four mutation paths.
 *
 * Why this is a sibling file (not an extension of `lineups.service.spec.ts`):
 * the 464-line parent spec wires a shared `createService()` helper that every
 * existing test depends on; adding the new DI provider to that helper would
 * ripple through ~30 tests. A focused sibling keeps the failing TDD surface
 * minimal and obviously related to the new feature.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { LineupsService } from './lineups.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { SettingsService } from '../settings/settings.service';
import { LineupPhaseQueueService } from './queue/lineup-phase.queue';
import { LineupSteamNudgeService } from './lineup-steam-nudge.service';
import { TasteProfileService } from '../taste-profile/taste-profile.service';
import { LineupNotificationService } from './lineup-notification.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { AiSuggestionsCacheInvalidator } from './ai-suggestions/cache.helpers';

// Mock the matching algorithm to avoid extra DB queries in unit tests
jest.mock('./lineups-matching.helpers', () => ({
  buildMatchesForLineup: jest.fn().mockResolvedValue(undefined),
}));

// Mock auto-carryover to avoid extra DB queries in unit tests (ROK-937)
jest.mock('./lineups-carryover.helpers', () => ({
  carryOverFromLastDecided: jest.fn().mockResolvedValue(undefined),
}));

// Mock standalone-poll query helper to avoid DB queries (ROK-1034)
jest.mock('./standalone-poll/standalone-poll-query.helpers', () => ({
  clearLinkedEventsByLineup: jest.fn().mockResolvedValue(undefined),
}));

// Mock notification hooks to avoid extra DB queries (ROK-932)
jest.mock('./lineups-notify-hooks.helpers', () => ({
  fireLineupCreated: jest.fn(),
  fireNominationMilestone: jest.fn(),
  fireVotingOpen: jest.fn(),
  fireDecidedNotifications: jest.fn(),
  fireNominationRemoved: jest.fn(),
  fireSchedulingOpen: jest.fn(),
  fireEventCreated: jest.fn(),
}));

/**
 * Stub the four mutation helper modules so the LineupsService methods we
 * exercise return synthetic detail payloads without touching the DB. The
 * cache-invalidation hooks are invoked AFTER each helper resolves, so the
 * stubs simulate successful mutations.
 */
jest.mock('./lineups-actions.helpers', () => ({
  runCreateLineup: jest.fn(),
  runToggleVote: jest.fn(),
  runNominate: jest.fn().mockResolvedValue({ id: 1, status: 'building' }),
}));
jest.mock('./lineups-invitees-actions.helpers', () => ({
  runAddInvitees: jest.fn().mockResolvedValue({ id: 1, status: 'building' }),
  runRemoveInvitee: jest.fn().mockResolvedValue({ id: 1, status: 'building' }),
}));
jest.mock('./lineups-query.helpers', () => ({
  findLineupById: jest.fn().mockResolvedValue([{ id: 1, status: 'building' }]),
}));
jest.mock('./lineups-removal.helpers', () => ({
  findEntry: jest.fn().mockResolvedValue({ id: 9, gameId: 5, nominatedBy: 10 }),
  validateRemoval: jest.fn(),
  deleteEntry: jest.fn().mockResolvedValue(undefined),
}));

interface ServiceHarness {
  service: LineupsService;
  invalidator: { invalidateForLineup: jest.Mock };
}

async function buildHarness(
  invalidateImpl?: (lineupId: number) => Promise<void>,
): Promise<ServiceHarness> {
  const invalidator = {
    invalidateForLineup: jest
      .fn<Promise<void>, [number]>()
      .mockImplementation(invalidateImpl ?? (() => Promise.resolve())),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      LineupsService,
      { provide: DrizzleAsyncProvider, useValue: {} },
      {
        provide: ActivityLogService,
        useValue: { log: jest.fn().mockResolvedValue(undefined) },
      },
      { provide: SettingsService, useValue: { get: jest.fn() } },
      {
        provide: LineupPhaseQueueService,
        useValue: { scheduleTransition: jest.fn() },
      },
      {
        provide: LineupSteamNudgeService,
        useValue: { nudgeUnlinkedMembers: jest.fn() },
      },
      {
        provide: LineupNotificationService,
        useValue: {
          notifyLineupCreated: jest.fn().mockResolvedValue(undefined),
          notifyNominationMilestone: jest.fn().mockResolvedValue(undefined),
          notifyVotingOpen: jest.fn().mockResolvedValue(undefined),
          notifyMatchesFound: jest.fn().mockResolvedValue(undefined),
          notifySchedulingOpen: jest.fn().mockResolvedValue(undefined),
          notifyNominationRemoved: jest.fn().mockResolvedValue(undefined),
          notifyEventCreated: jest.fn().mockResolvedValue(undefined),
        },
      },
      {
        provide: DiscordBotClientService,
        useValue: { getGuild: jest.fn().mockReturnValue(null) },
      },
      {
        provide: TasteProfileService,
        useValue: {
          getTasteVectorsForUsers: jest.fn().mockResolvedValue(new Map()),
        },
      },
      {
        provide: AiSuggestionsCacheInvalidator,
        useValue: invalidator,
      },
    ],
  }).compile();

  const service = module.get<LineupsService>(LineupsService);
  return { service, invalidator };
}

describe('LineupsService — AI suggestions cache invalidation (ROK-931)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('invalidates the AI suggestions cache after a successful nominate', async () => {
    const { service, invalidator } = await buildHarness();
    await service.nominate(1, { gameId: 5 }, 10, 'member');
    expect(invalidator.invalidateForLineup).toHaveBeenCalledTimes(1);
    expect(invalidator.invalidateForLineup).toHaveBeenCalledWith(1);
  });

  it('invalidates the AI suggestions cache after a successful removeNomination', async () => {
    const { service, invalidator } = await buildHarness();
    await service.removeNomination(1, 5, { id: 10, role: 'member' });
    expect(invalidator.invalidateForLineup).toHaveBeenCalledTimes(1);
    expect(invalidator.invalidateForLineup).toHaveBeenCalledWith(1);
  });

  it('invalidates the AI suggestions cache after a successful addInvitees', async () => {
    const { service, invalidator } = await buildHarness();
    await service.addInvitees(1, [20, 21], 10);
    expect(invalidator.invalidateForLineup).toHaveBeenCalledTimes(1);
    expect(invalidator.invalidateForLineup).toHaveBeenCalledWith(1);
  });

  it('invalidates the AI suggestions cache after a successful removeInvitee', async () => {
    const { service, invalidator } = await buildHarness();
    await service.removeInvitee(1, 20, 10);
    expect(invalidator.invalidateForLineup).toHaveBeenCalledTimes(1);
    expect(invalidator.invalidateForLineup).toHaveBeenCalledWith(1);
  });

  it('does NOT fail the parent mutation when the invalidator throws', async () => {
    // Spec §API Changes > Cache invalidation hooks: invalidation runs in a
    // try/catch AFTER the parent mutation succeeds and logs but does not
    // fail the parent.
    const loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const loggerWarnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const { service, invalidator } = await buildHarness(async () => {
      throw new Error('synthetic invalidator failure');
    });

    // Parent must resolve — cache invalidation failure must not surface.
    await expect(
      service.nominate(1, { gameId: 5 }, 10, 'member'),
    ).resolves.toEqual(expect.objectContaining({ id: 1 }));
    expect(invalidator.invalidateForLineup).toHaveBeenCalledTimes(1);
    // Failure must be observable somewhere in the logs so it isn't silent.
    const logged =
      loggerErrorSpy.mock.calls.length + loggerWarnSpy.mock.calls.length;
    expect(logged).toBeGreaterThan(0);
    loggerErrorSpy.mockRestore();
    loggerWarnSpy.mockRestore();
  });
});
