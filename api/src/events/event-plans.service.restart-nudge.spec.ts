/**
 * ROK-1428 Codex r12 P2 — restarting an expired/cancelled plan is game
 * activity: it must reach the same post-commit lifecycle nudge `create` uses,
 * so an archived game channel is restored now rather than at the daily run.
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
import { restartPlan } from './event-plans-ops.helpers';
import type { EventPlanResponseDto } from '@raid-ledger/contract';

jest.mock('./event-plans-ops.helpers', () => ({
  ...jest.requireActual<object>('./event-plans-ops.helpers'),
  restartPlan: jest.fn(),
}));

const CREATOR_ID = 42;
const PLAN = { id: 'plan-1', creatorId: CREATOR_ID, status: 'expired' };
const NOW = new Date().toISOString();
const RESTARTED: EventPlanResponseDto = {
  id: PLAN.id,
  creatorId: CREATOR_ID,
  title: 'Raid Night',
  description: null,
  gameId: 7,
  slotConfig: null,
  maxAttendees: null,
  autoUnbench: true,
  durationMinutes: 120,
  pollOptions: [],
  pollDurationHours: 24,
  pollMode: 'standard',
  pollRound: 2,
  pollChannelId: 'ch-1',
  pollMessageId: 'msg-2',
  status: 'polling',
  winningOption: null,
  createdEventId: null,
  pollStartedAt: NOW,
  pollEndsAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
};

async function build(nudge: { touch: jest.Mock }, gameId: number | null) {
  const db = createDrizzleMock();
  db.limit.mockResolvedValue([{ ...PLAN, gameId }]);
  const module = await Test.createTestingModule({
    providers: [
      EventPlansService,
      { provide: DrizzleAsyncProvider, useValue: db },
      { provide: getQueueToken(EVENT_PLANS_QUEUE), useValue: {} },
      { provide: DiscordBotClientService, useValue: {} },
      { provide: ChannelResolverService, useValue: {} },
      { provide: SettingsService, useValue: {} },
      { provide: EventsService, useValue: {} },
      { provide: SignupsService, useValue: {} },
      { provide: GameActivityNudge, useValue: nudge },
    ],
  }).compile();
  return module.get(EventPlansService);
}

describe('EventPlansService.restart — lifecycle nudge (Codex r12 P2)', () => {
  beforeEach(() => {
    jest.mocked(restartPlan).mockReset();
  });

  it('nudges the plan game after the restart commits', async () => {
    const nudge = { touch: jest.fn() };
    const service = await build(nudge, 7);
    jest.mocked(restartPlan).mockImplementationOnce(() => {
      expect(nudge.touch).not.toHaveBeenCalled();
      return Promise.resolve(RESTARTED);
    });
    await service.restart(PLAN.id, CREATOR_ID);
    expect(nudge.touch).toHaveBeenCalledWith(7);
  });

  it('does not nudge when the restart fails', async () => {
    const nudge = { touch: jest.fn() };
    const service = await build(nudge, 7);
    jest.mocked(restartPlan).mockRejectedValueOnce(new Error('discord down'));
    await expect(service.restart(PLAN.id, CREATOR_ID)).rejects.toThrow(
      'discord down',
    );
    expect(nudge.touch).not.toHaveBeenCalled();
  });
});
