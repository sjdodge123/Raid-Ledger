/**
 * ROK-2301 (unit): an EXISTING non-hub poll post in the event-planning forum
 * takes its derived name on `syncPoll`, and the reconnect catch-up
 * `resyncLivePollPosts` re-syncs every live poll post. A matching name is
 * left alone (a second pass renames nothing), a locked or off-path post is
 * never renamed, a gone post is marked deleted, one failing poll does not
 * stop the rest.
 */
import { Logger } from '@nestjs/common';
import { DiscordAPIError } from 'discord.js';
import type { EventPlanningPostSelect } from '../../../drizzle/schema/event-planning-posts';
import type { SchedulingPollForumCard } from '../../../lineups/scheduling/scheduling-poll-forum-card';
import type { SchedulingPollEmbedQueueService } from '../../../lineups/scheduling/scheduling-poll-embed.queue';
import type { SettingsService } from '../../../settings/settings.service';
import { findPollForSync } from '../subject-discussion/poll-discussion.queries';
import type { EventPlanningPostCreator } from './event-planning-posts.create';
import type { EventPlanningPostsGateway } from './event-planning-posts.discord';
import {
  findLivePlanningPost,
  markPlanningPostDeleted,
  setPlanningPostClosesAt,
} from './event-planning-posts.queries';
import { pollWriteClosesAt } from '../subject-discussion/poll-discussion.sync';
import { liveOpenPollPosts } from './event-planning-posts.reconcile';
import { EventPlanningSubjectPosts } from './event-planning-posts.subjects';
import { pollOnPlanningPath } from './event-planning-posts.subjects.rules';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

jest.mock('../subject-discussion/poll-discussion.queries', () => ({
  ...jest.requireActual<object>(
    '../subject-discussion/poll-discussion.queries',
  ),
  findPollForSync: jest.fn(),
}));
jest.mock('../subject-discussion/poll-discussion.sync', () => ({
  ...jest.requireActual<object>('../subject-discussion/poll-discussion.sync'),
  pollWriteClosesAt: jest.fn(() => null),
}));
jest.mock('./event-planning-posts.queries', () => ({
  ...jest.requireActual<object>('./event-planning-posts.queries'),
  findLivePlanningPost: jest.fn(),
  markPlanningPostDeleted: jest.fn(),
  setPlanningPostClosesAt: jest.fn(),
}));
jest.mock('./event-planning-posts.reconcile', () => ({
  ...jest.requireActual<object>('./event-planning-posts.reconcile'),
  liveOpenPollPosts: jest.fn(),
}));
jest.mock('./event-planning-posts.subjects.rules', () => ({
  ...jest.requireActual<object>('./event-planning-posts.subjects.rules'),
  pollOnPlanningPath: jest.fn(() => true),
}));
jest.mock('./hub-forum-discord-subject', () => ({
  ...jest.requireActual<object>('./hub-forum-discord-subject'),
  pollPostTitle: jest.fn(() => 'WoW — Poll (after Thursday Raid)'),
}));

const NEW_NAME = 'WoW — Poll (after Thursday Raid)';

function discordError(code: number): DiscordAPIError {
  return new DiscordAPIError(
    { code, message: `code ${String(code)}` },
    code,
    400,
    'PATCH',
    '/channels/900',
    {},
  );
}

function post(over: Partial<EventPlanningPostSelect> = {}) {
  return {
    id: 1,
    subjectKind: 'poll',
    subjectId: 7,
    discordThreadId: '900',
    closesAt: null,
    discordLockedAt: null,
    discordDeletedAt: null,
    ...over,
  } as EventPlanningPostSelect;
}

/** A gateway that, like the real one, renames only when the name differs. */
function fakeDiscord(online = true) {
  const names = new Map<string, string>([
    ['900', 'Standalone Scheduling Poll — Poll'],
    ['910', 'WoW — Poll'],
  ]);
  const setName = jest.fn();
  const renameThread = jest.fn((id: string, name: string) => {
    if (names.get(id) !== name) {
      setName(id, name);
      names.set(id, name);
    }
    return Promise.resolve('ok' as const);
  });
  return { isOnline: () => online, renameThread, setName };
}

function setup(online = true) {
  const discord = fakeDiscord(online);
  const subjects = new EventPlanningSubjectPosts(
    {} as unknown as ForumDiscordDb,
    {} as unknown as SettingsService,
    {} as unknown as EventPlanningPostCreator,
    {} as unknown as SchedulingPollForumCard,
    {} as unknown as SchedulingPollEmbedQueueService,
    discord as unknown as EventPlanningPostsGateway,
  );
  return { subjects, discord };
}

beforeEach(() => {
  jest
    .mocked(findPollForSync)
    .mockResolvedValue({ matchId: 7 } as unknown as Awaited<
      ReturnType<typeof findPollForSync>
    >);
  jest.mocked(findLivePlanningPost).mockResolvedValue(post());
});

afterEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

describe('ROK-2301 syncPoll renames an existing non-hub poll post', () => {
  it('a stale name is renamed to the derived name', async () => {
    const { subjects, discord } = setup();
    await subjects.syncPoll(7);
    expect(discord.renameThread).toHaveBeenCalledWith('900', NEW_NAME);
    expect(discord.setName).toHaveBeenCalledWith('900', NEW_NAME);
  });

  it('a matching name is left alone', async () => {
    const { subjects, discord } = setup();
    await subjects.syncPoll(7);
    await subjects.syncPoll(7);
    expect(discord.setName).toHaveBeenCalledTimes(1);
  });

  it('never renames a locked post, an off-path poll or while offline', async () => {
    const locked = setup();
    jest
      .mocked(findLivePlanningPost)
      .mockResolvedValueOnce(post({ discordLockedAt: new Date() }));
    await locked.subjects.syncPoll(7);
    expect(locked.discord.renameThread).not.toHaveBeenCalled();

    const offPath = setup();
    jest.mocked(pollOnPlanningPath).mockReturnValueOnce(false);
    await offPath.subjects.syncPoll(7);
    expect(offPath.discord.renameThread).not.toHaveBeenCalled();

    const offline = setup(false);
    await offline.subjects.syncPoll(7);
    expect(offline.discord.renameThread).not.toHaveBeenCalled();
  });

  it('a post deleted on Discord is marked gone', async () => {
    const { subjects, discord } = setup();
    discord.renameThread.mockResolvedValueOnce('gone' as never);
    await subjects.syncPoll(7);
    expect(markPlanningPostDeleted).toHaveBeenCalledWith(
      expect.anything(),
      1,
      expect.any(Date),
    );
  });

  it('NIT-1: a gone post is marked deleted at the caller-supplied now', async () => {
    const { subjects, discord } = setup();
    const now = new Date('2026-01-02T03:04:05Z');
    discord.renameThread.mockResolvedValueOnce('gone' as never);
    await subjects.syncPoll(7, now);
    expect(markPlanningPostDeleted).toHaveBeenCalledWith(
      expect.anything(),
      1,
      now,
    );
  });
});

describe('ROK-2301 MINOR-2: renaming an auto-archived post (50083)', () => {
  function spies() {
    return {
      warn: jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined),
      debug: jest
        .spyOn(Logger.prototype, 'debug')
        .mockImplementation(() => undefined),
    };
  }

  it('is skipped quietly: no throw, no warn, one debug line, closes_at still written', async () => {
    const log = spies();
    const closesAt = new Date('2026-02-01T00:00:00Z');
    jest.mocked(pollWriteClosesAt).mockReturnValueOnce(closesAt);
    const { subjects, discord } = setup();
    discord.renameThread.mockRejectedValueOnce(discordError(50083));
    await expect(subjects.syncPoll(7)).resolves.toBeUndefined();
    expect(setPlanningPostClosesAt).toHaveBeenCalledWith(
      expect.anything(),
      1,
      closesAt,
    );
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.debug).toHaveBeenCalledTimes(1);
    expect(markPlanningPostDeleted).not.toHaveBeenCalled();
  });

  it('a different Discord error still fails the poll as before', async () => {
    spies();
    const { subjects, discord } = setup();
    discord.renameThread.mockRejectedValueOnce(discordError(50013));
    await expect(subjects.syncPoll(7)).rejects.toThrow('code 50013');
  });
});

describe('ROK-2301 resyncLivePollPosts (bot-connect catch-up)', () => {
  function twoPosts() {
    const a = post();
    const b = post({ id: 2, subjectId: 8, discordThreadId: '910' });
    jest.mocked(liveOpenPollPosts).mockResolvedValue([a, b]);
    jest
      .mocked(findLivePlanningPost)
      .mockImplementation((_db, _kind, id) =>
        Promise.resolve(id === 7 ? a : b),
      );
  }

  it('renames every live post once; a second run renames nothing', async () => {
    twoPosts();
    const { subjects, discord } = setup();
    expect(await subjects.resyncLivePollPosts()).toBe(2);
    expect(discord.setName).toHaveBeenCalledTimes(2);
    expect(await subjects.resyncLivePollPosts()).toBe(2);
    expect(discord.setName).toHaveBeenCalledTimes(2);
  });

  it('one failing poll is warned and the rest still run', async () => {
    twoPosts();
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const { subjects, discord } = setup();
    discord.renameThread.mockRejectedValueOnce(new Error('429'));
    expect(await subjects.resyncLivePollPosts()).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('poll 7'));
    expect(discord.renameThread).toHaveBeenCalledWith('910', NEW_NAME);
  });

  it('MINOR-2: an archived post counts as synced and is never warned', async () => {
    twoPosts();
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    const { subjects, discord } = setup();
    discord.renameThread.mockRejectedValueOnce(discordError(50083));
    expect(await subjects.resyncLivePollPosts()).toBe(2);
    expect(warn).not.toHaveBeenCalled();
    expect(discord.renameThread).toHaveBeenCalledWith('910', NEW_NAME);
  });
});
