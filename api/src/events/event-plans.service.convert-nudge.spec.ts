/**
 * ROK-1428 Codex r13 P2 — converting an event into a plan posts a new poll,
 * which is game activity: it must reach the same post-commit lifecycle nudge
 * `create` and `restart` use, so an archived game channel is restored now
 * rather than at the daily reconcile (`event.cancelled` is not a nudge signal).
 */
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { EventPlansService, EVENT_PLANS_QUEUE } from './event-plans.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { createDrizzleMock } from '../common/testing/drizzle-mock';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { ChannelResolverService } from '../discord-bot/services/channel-resolver.service';
import { EventsService } from './events.service';
import { SignupsService } from './signups.service';
import { SettingsService } from '../settings/settings.service';
import { GameActivityNudge } from '../discord-bot/channel-lifecycle/channel-lifecycle.nudge';
import { executeConversion } from './event-plans-ops.helpers';
import type { EventPlanResponseDto } from '@raid-ledger/contract';
import type * as schema from '../drizzle/schema';

jest.mock('./event-plans-ops.helpers', () => ({
  ...jest.requireActual<object>('./event-plans-ops.helpers'),
  executeConversion: jest.fn(),
}));

const CREATOR_ID = 42;
const EVENT_ID = 9;
const NOW = new Date().toISOString();

function planDto(gameId: number | null): EventPlanResponseDto {
  return {
    id: 'plan-1',
    creatorId: CREATOR_ID,
    title: 'Raid Night',
    description: null,
    gameId,
    slotConfig: null,
    maxAttendees: null,
    autoUnbench: true,
    durationMinutes: 120,
    pollOptions: [],
    pollDurationHours: 24,
    pollMode: 'standard',
    pollRound: 1,
    pollChannelId: 'ch-1',
    pollMessageId: 'msg-1',
    status: 'polling',
    winningOption: null,
    createdEventId: null,
    pollStartedAt: NOW,
    pollEndsAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function planRow(gameId: number | null): typeof schema.eventPlans.$inferSelect {
  const at = new Date(NOW);
  return {
    id: 'plan-1',
    creatorId: CREATOR_ID,
    title: 'Raid Night',
    description: null,
    gameId,
    slotConfig: null,
    maxAttendees: null,
    autoUnbench: true,
    durationMinutes: 120,
    pollOptions: [],
    pollDurationHours: 24,
    pollMode: 'standard',
    pollRound: 1,
    pollChannelId: 'ch-1',
    pollMessageId: 'msg-1',
    status: 'polling',
    winningOption: null,
    createdEventId: null,
    contentInstances: null,
    reminder15min: true,
    reminder1hour: true,
    reminder24hour: true,
    pollStartedAt: at,
    pollEndsAt: at,
    createdAt: at,
    updatedAt: at,
  };
}

async function build(nudge: { touch: jest.Mock }) {
  const events = {
    findOne: jest.fn().mockResolvedValue({
      id: EVENT_ID,
      creator: { id: CREATOR_ID },
    }),
    cancel: jest.fn().mockResolvedValue(undefined),
  };
  const module = await Test.createTestingModule({
    providers: [
      EventPlansService,
      { provide: DrizzleAsyncProvider, useValue: createDrizzleMock() },
      { provide: getQueueToken(EVENT_PLANS_QUEUE), useValue: {} },
      { provide: DiscordBotClientService, useValue: {} },
      { provide: ChannelResolverService, useValue: {} },
      { provide: SettingsService, useValue: {} },
      { provide: EventsService, useValue: events },
      { provide: SignupsService, useValue: {} },
      { provide: GameActivityNudge, useValue: nudge },
    ],
  }).compile();
  return module.get(EventPlansService);
}

function resolveConversion(gameId: number | null, before?: () => void) {
  jest.mocked(executeConversion).mockImplementationOnce(() => {
    before?.();
    return Promise.resolve({ plan: planRow(gameId), dto: planDto(gameId) });
  });
}

describe('EventPlansService.convertFromEvent — lifecycle nudge (Codex r13 P2)', () => {
  beforeEach(() => {
    jest.mocked(executeConversion).mockReset();
  });

  it('nudges the converted plan game after the conversion commits', async () => {
    const nudge = { touch: jest.fn() };
    const service = await build(nudge);
    resolveConversion(7, () => expect(nudge.touch).not.toHaveBeenCalled());
    await service.convertFromEvent(EVENT_ID, CREATOR_ID);
    expect(nudge.touch).toHaveBeenCalledWith(7);
  });

  it('does not nudge when the conversion fails', async () => {
    const nudge = { touch: jest.fn() };
    const service = await build(nudge);
    jest
      .mocked(executeConversion)
      .mockRejectedValueOnce(new Error('discord down'));
    await expect(
      service.convertFromEvent(EVENT_ID, CREATOR_ID),
    ).rejects.toThrow('discord down');
    expect(nudge.touch).not.toHaveBeenCalled();
  });

  it('does not throw when the converted plan has no game', async () => {
    const nudge = { touch: jest.fn() };
    const service = await build(nudge);
    resolveConversion(null);
    await expect(
      service.convertFromEvent(EVENT_ID, CREATOR_ID),
    ).resolves.toMatchObject({ id: 'plan-1', gameId: null });
  });
});
