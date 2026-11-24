/**
 * ROK-2314 review MINOR-1 — the registry lock sweep re-arms an event's
 * signup flush once its post reopens (unit). The flush held its lines while
 * the post was shut for the reschedule poll.
 */
import type { EventForumStarterCards } from '../../../discord-bot/services/event-forum-starter.cards';
import type { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import { EventPlanningPostsLockSweep } from './event-planning-posts.lock';
import type { EventPlanningPostsService } from './event-planning-posts.service';
import type { EventPlanningSubjectPosts } from './event-planning-posts.subjects';
import type { HubForumDiscordEventLockGateway } from './hub-forum-discord-event-lock.gateway';
import type { HubForumDiscordSignupPingQueue } from './hub-forum-discord-signup-pings.queue';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

jest.mock('./event-planning-posts.queries', () => ({
  ...jest.requireActual<object>('./event-planning-posts.queries'),
  markPlanningPostDeleted: jest.fn().mockResolvedValue(undefined),
  setPlanningPostLocked: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../discord-bot/services/event-forum-starter.cards', () => ({
  ...jest.requireActual<object>(
    '../../../discord-bot/services/event-forum-starter.cards',
  ),
  deleteForumStarterRows: jest.fn().mockResolvedValue(undefined),
}));

const NOW = new Date('2026-11-24T12:00:00Z');

interface DueRow {
  postId: number;
  subjectKind: 'event' | 'poll' | 'lineup';
  subjectId: number;
  discordThreadId: string;
  /** Recorded locked ⇒ the sweep reopens it. */
  locked: boolean;
}

/** A db whose due-post select resolves `rows`. */
function fakeDb(rows: DueRow[]): ForumDiscordDb {
  const limit = jest.fn().mockResolvedValue(rows);
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => ({ limit }),
  };
  return { select: () => chain } as unknown as ForumDiscordDb;
}

function setup(rows: DueRow[]) {
  const gateway = { setReadOnly: jest.fn().mockResolvedValue('ok') };
  const client = { isConnected: () => true };
  const service = { syncEvent: jest.fn().mockResolvedValue(undefined) };
  const starters = { restore: jest.fn().mockResolvedValue(true) };
  const pings = { schedule: jest.fn().mockResolvedValue(true) };
  const sweep = new EventPlanningPostsLockSweep(
    fakeDb(rows),
    gateway as unknown as HubForumDiscordEventLockGateway,
    client as unknown as DiscordBotClientService,
    service as unknown as EventPlanningPostsService,
    {} as EventPlanningSubjectPosts,
    starters as unknown as EventForumStarterCards,
    pings as unknown as HubForumDiscordSignupPingQueue,
  );
  return { sweep, gateway, service, pings };
}

const due = (over: Partial<DueRow>): DueRow => ({
  postId: 1,
  subjectKind: 'event',
  subjectId: 42,
  discordThreadId: '9',
  locked: true,
  ...over,
});

describe('ROK-2314 MINOR-1: a reopened registry event post re-arms its flush', () => {
  it('an event reopen schedules the flush after the title refresh', async () => {
    const { sweep, service, pings } = setup([due({})]);
    expect(await sweep.sweepEvent(42, NOW)).toBe(1);
    expect(pings.schedule).toHaveBeenCalledWith(42);
    const refreshAt = service.syncEvent.mock.invocationCallOrder[0] ?? -1;
    const flushAt = pings.schedule.mock.invocationCallOrder[0] ?? -1;
    expect(refreshAt).toBeLessThan(flushAt);
  });

  it.each<[string, Partial<DueRow>]>([
    ['an event close', { locked: false }],
    ['a poll reopen', { subjectKind: 'poll' }],
    ['a lineup reopen', { subjectKind: 'lineup' }],
  ])('%s schedules no flush', async (_, over) => {
    const { sweep, gateway, pings } = setup([due(over)]);
    await sweep.sweepEvent(42, NOW);
    expect(gateway.setReadOnly).toHaveBeenCalledTimes(1);
    expect(pings.schedule).not.toHaveBeenCalled();
  });

  it('a reopen Discord refused schedules no flush', async () => {
    const { sweep, gateway, pings } = setup([due({})]);
    gateway.setReadOnly.mockRejectedValueOnce(new Error('50013'));
    expect(await sweep.sweepEvent(42, NOW)).toBe(0);
    expect(pings.schedule).not.toHaveBeenCalled();
  });
});
