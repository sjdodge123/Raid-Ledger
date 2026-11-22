/**
 * ROK-2295 (Lead ruling Q1 b) — the reschedule cross-links: both lines sent
 * with no pings, an event without an open post gets only the poll-side line
 * (its page), a non-reschedule poll links nothing, the NX key blocks a rerun,
 * and a failing send never throws.
 */
import type Redis from 'ioredis';
import type { EventPlanningPostSelect } from '../../../drizzle/schema/event-planning-posts';
import { getClientUrl } from '../../../settings/settings-bot.helpers';
import type { SettingsService } from '../../../settings/settings.service';
import { findLiveEventThread } from '../event-discussion/event-discussion.queries';
import {
  findPollForSync,
  type PollSyncRow,
} from '../subject-discussion/poll-discussion.queries';
import { findLivePlanningPost } from './event-planning-posts.queries';
import {
  findThreadLink,
  type ForumLink,
} from './hub-forum-discord-links.queries';
import type { HubForumDiscordOutboundGateway } from './hub-forum-discord-outbound.discord';
import type { ForumDiscordDb } from './hub-forum-discord.queries';
import {
  crosslinkKey,
  PollRescheduleCrosslink,
} from './poll-reschedule-crosslink';

jest.mock('../../../settings/settings-bot.helpers');
jest.mock('../event-discussion/event-discussion.queries');
jest.mock('../subject-discussion/poll-discussion.queries');
jest.mock('./event-planning-posts.queries');
jest.mock('./hub-forum-discord-links.queries', () => ({
  ...jest.requireActual<object>('./hub-forum-discord-links.queries'),
  findThreadLink: jest.fn(),
}));

const NOW = new Date('2026-11-22T12:00:00Z');
const POLL_THREAD = 'd-poll';

const POLL: PollSyncRow = {
  matchId: 21,
  lineupId: 4,
  status: 'scheduling',
  lineupStatus: 'decided',
  phaseDeadline: null,
  linkedEventId: 9,
  linkedEventTitle: 'Thursday Raid',
  guildId: 7,
  visibility: 'public',
  creatorId: 1,
  gameName: 'WoW',
  lineupTitle: 'Standalone Scheduling Poll',
  standalone: true,
};

const LINK: ForumLink = {
  id: 11,
  guildId: 7,
  kind: 'thread',
  threadId: 3,
  replyId: null,
  discordThreadId: 'd-event',
  discordMessageId: 'd-event',
  origin: 'raidledger',
  syncState: 'synced',
  attempts: 0,
  lastError: null,
  syncedAt: NOW,
  discordDeletedAt: null,
  discordLockedAt: null,
  createdAt: NOW,
};

const PLANNING: EventPlanningPostSelect = {
  id: 5,
  subjectKind: 'event',
  subjectId: 9,
  forumId: 2,
  discordThreadId: 'd-planning',
  closesAt: null,
  discordLockedAt: null,
  discordDeletedAt: null,
  createdAt: NOW,
};

const mocked = {
  poll: jest.mocked(findPollForSync),
  eventThread: jest.mocked(findLiveEventThread),
  link: jest.mocked(findThreadLink),
  planning: jest.mocked(findLivePlanningPost),
  clientUrl: jest.mocked(getClientUrl),
};

function setup(claim: 'OK' | null = 'OK') {
  const mention = jest.fn<Promise<void>, [string, string, string[]]>();
  mention.mockResolvedValue(undefined);
  const set = jest.fn().mockResolvedValue(claim);
  const gateway: Pick<HubForumDiscordOutboundGateway, 'mention'> = { mention };
  const svc = new PollRescheduleCrosslink(
    {} as ForumDiscordDb,
    gateway as HubForumDiscordOutboundGateway,
    {} as SettingsService,
    { set } as unknown as Redis,
  );
  return { svc, mention, set };
}

beforeEach(() => {
  jest.clearAllMocks();
  mocked.poll.mockResolvedValue(POLL);
  mocked.eventThread.mockResolvedValue({
    id: 3,
    guildId: 7,
    title: 'Thursday Raid',
    body: '',
    writeClosesAt: null,
  });
  mocked.link.mockResolvedValue(LINK);
  mocked.planning.mockResolvedValue(null);
  mocked.clientUrl.mockResolvedValue('https://rl.example/');
});

describe('PollRescheduleCrosslink.linkPollPost', () => {
  it('sends both lines with no pings', async () => {
    const { svc, mention } = setup();
    await svc.linkPollPost(21, POLL_THREAD);
    expect(mention.mock.calls).toEqual([
      [POLL_THREAD, '↩ Continues the chat from <#d-event>', []],
      ['d-event', '🗳 Rescheduling: vote on the new time in <#d-poll>', []],
    ]);
  });

  it('falls back to the event registry post when the hub has none', async () => {
    mocked.eventThread.mockResolvedValue(null);
    mocked.planning.mockResolvedValue(PLANNING);
    const { svc, mention } = setup();
    await svc.linkPollPost(21, POLL_THREAD);
    expect(mention.mock.calls.map((c) => c[0])).toEqual([
      POLL_THREAD,
      'd-planning',
    ]);
  });

  it('event post missing (unsent hub link, no registry) ⇒ only the poll-side page link', async () => {
    mocked.link.mockResolvedValue({ ...LINK, discordMessageId: 'rl:t:3' });
    const { svc, mention } = setup();
    await svc.linkPollPost(21, POLL_THREAD);
    expect(mention.mock.calls).toEqual([
      [
        POLL_THREAD,
        '↩ Continues the chat about Thursday Raid: https://rl.example/events/9',
        [],
      ],
    ]);
  });

  it('a locked event post is skipped like a missing one', async () => {
    mocked.link.mockResolvedValue({ ...LINK, discordLockedAt: NOW });
    const { svc, mention } = setup();
    await svc.linkPollPost(21, POLL_THREAD);
    expect(mention.mock.calls.map((c) => c[0])).toEqual([POLL_THREAD]);
  });

  it('a poll that reschedules nothing links nothing and claims no key', async () => {
    mocked.poll.mockResolvedValue({ ...POLL, linkedEventTitle: null });
    const { svc, mention, set } = setup();
    await svc.linkPollPost(21, POLL_THREAD);
    expect(set).not.toHaveBeenCalled();
    expect(mention).not.toHaveBeenCalled();
  });

  it('the NX key blocks a second run', async () => {
    const { svc, mention, set } = setup(null);
    await svc.linkPollPost(21, POLL_THREAD);
    expect(set).toHaveBeenCalledWith(
      crosslinkKey(21, POLL_THREAD),
      '1',
      'EX',
      expect.any(Number),
      'NX',
    );
    expect(mention).not.toHaveBeenCalled();
  });

  it('a failed poll-side send still sends the event side and never throws', async () => {
    const { svc, mention } = setup();
    mention.mockRejectedValueOnce(new Error('50083 archived'));
    await expect(svc.linkPollPost(21, POLL_THREAD)).resolves.toBeUndefined();
    expect(mention).toHaveBeenCalledTimes(2);
  });

  it('a failing read never throws', async () => {
    mocked.poll.mockRejectedValue(new Error('db down'));
    const { svc, mention } = setup();
    await expect(svc.linkPollPost(21, POLL_THREAD)).resolves.toBeUndefined();
    expect(mention).not.toHaveBeenCalled();
  });
});
