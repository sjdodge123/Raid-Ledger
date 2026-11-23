/**
 * ROK-2295 review M-1 — a hub poll post opens with the live poll embed and
 * has no `discord_event_messages` starter row, so a `thread.updated`
 * re-drive (reopen / S6 retry) must rename only: writing the text root body
 * back would leave the starter as text + embed (AC2: content '').
 */
import type { EventForumStarterCards } from '../../../discord-bot/services/event-forum-starter.cards';
import type { SchedulingPollForumCard } from '../../../lineups/scheduling/scheduling-poll-forum-card';
import type { SettingsService } from '../../../settings/settings.service';
import * as threads from '../hub-forum.queries';
import type { HubForumThreadRecord } from '../hub-forum.mappers';
import * as reads from './hub-forum-discord-event-outbound.queries';
import * as links from './hub-forum-discord-links.queries';
import type { HubForumDiscordOutboundGateway } from './hub-forum-discord-outbound.discord';
import { HubForumDiscordOutboundService } from './hub-forum-discord-outbound.service';
import * as voice from './hub-forum-discord-outbound.voice';
import * as subjectReads from './hub-forum-discord-subject-post.queries';
import * as bindings from './hub-forum-discord.queries';
import type {
  BindingWithForum,
  ForumDiscordDb,
} from './hub-forum-discord.queries';

// Factory mocks: automocking these query modules recurses into the schema.
jest.mock('../hub-forum.queries', () => ({
  findThread: jest.fn(),
  findReply: jest.fn(),
}));
jest.mock('./hub-forum-discord-event-outbound.queries', () => ({
  syncBornAt: jest.fn(),
  hasForumStarterCard: jest.fn(),
}));
jest.mock('./hub-forum-discord-links.queries', () => ({
  findThreadLink: jest.fn(),
  isEditableLink: jest.fn(),
  markSynced: jest.fn(),
  markFailed: jest.fn(),
}));
jest.mock('./hub-forum-discord-outbound.voice', () => ({
  outboundUrl: jest.fn(),
  outboundVoice: jest.fn(),
}));
jest.mock('./hub-forum-discord-subject-post.queries', () => ({
  findSubjectPostSource: jest.fn(),
}));
jest.mock('./hub-forum-discord.queries', () => ({ findBinding: jest.fn() }));

const NOW = new Date('2025-11-20T12:00:00Z');
const BOUND_AT = new Date('2025-11-01T00:00:00Z');

const LINK: links.ForumLink = {
  id: 11,
  guildId: 7,
  kind: 'thread',
  threadId: 3,
  replyId: null,
  discordThreadId: 'post-1',
  discordMessageId: 'post-1',
  origin: 'raidledger',
  syncState: 'synced',
  attempts: 0,
  lastError: null,
  syncedAt: NOW,
  discordDeletedAt: null,
  discordLockedAt: null,
  createdAt: NOW,
};

function record(subject: { matchId: number | null }): HubForumThreadRecord {
  const thread = {
    id: 3,
    title: 'WoW',
    body: 'Scheduling poll for **WoW**. [Open the poll](/x)',
    eventId: null,
    matchId: subject.matchId,
    lineupId: null,
  };
  return { thread, author: null } as unknown as HubForumThreadRecord;
}

function setup(subject: { matchId: number | null }) {
  const bound = {
    binding: { boundAt: BOUND_AT, tagId: null },
    forum: { channelId: 'forum-1', webhookId: 'wh-1' },
  } as unknown as BindingWithForum;
  jest.mocked(bindings.findBinding).mockResolvedValue(bound);
  jest.mocked(reads.syncBornAt).mockResolvedValue(NOW);
  jest.mocked(reads.hasForumStarterCard).mockResolvedValue(false);
  jest.mocked(links.findThreadLink).mockResolvedValue(LINK);
  jest.mocked(links.isEditableLink).mockReturnValue(true);
  jest.mocked(threads.findThread).mockResolvedValue(record(subject));
  jest.mocked(voice.outboundUrl).mockResolvedValue('https://rl/x');
  jest.mocked(subjectReads.findSubjectPostSource).mockResolvedValue(null);
  const gateway = {
    editMessage: jest.fn(() => Promise.resolve('ok' as const)),
    renameThread: jest.fn(() => Promise.resolve('ok' as const)),
  };
  const svc = new HubForumDiscordOutboundService(
    {} as ForumDiscordDb,
    gateway as unknown as HubForumDiscordOutboundGateway,
    {} as unknown as SettingsService,
    {} as unknown as EventForumStarterCards,
    {} as unknown as SchedulingPollForumCard,
  );
  svc.now = () => NOW;
  return { svc, gateway };
}

describe('ROK-2295 M-1: a poll post re-driven by thread.updated', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renames only; the poll embed starter is never overwritten with text', async () => {
    const t = setup({ matchId: 42 });
    await expect(t.svc.retry(LINK, 'thread.updated')).resolves.toBe(
      'dispatched',
    );
    expect(t.gateway.editMessage).not.toHaveBeenCalled();
    expect(t.gateway.renameThread).toHaveBeenCalledWith(
      'post-1',
      expect.any(String),
      expect.any(Function),
    );
    expect(links.markSynced).toHaveBeenCalledWith({}, 11, NOW);
  });

  it('a plain (uncarded) thread still gets its text starter re-written', async () => {
    const t = setup({ matchId: null });
    await t.svc.retry(LINK, 'thread.updated');
    expect(t.gateway.editMessage).toHaveBeenCalledWith(
      { channelId: 'forum-1', webhookId: 'wh-1' },
      { threadId: 'post-1', messageId: 'post-1' },
      expect.stringContaining('Scheduling poll for **WoW**'),
    );
  });
});
