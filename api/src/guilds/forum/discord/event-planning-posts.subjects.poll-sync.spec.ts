/**
 * ROK-2295 Codex P2 — a vote or lock-in that lands while a non-hub poll's
 * post is being created runs its coalesced card sync before the registry row
 * exists (no post to edit ⇒ skipped). `ensurePollPost` therefore enqueues
 * one more sync once the post is recorded — and only when it created one.
 */
import type { SchedulingPollEmbedQueueService } from '../../../lineups/scheduling/scheduling-poll-embed.queue';
import type { SchedulingPollForumCard } from '../../../lineups/scheduling/scheduling-poll-forum-card';
import type { SettingsService } from '../../../settings/settings.service';
import { findPollForSync } from '../subject-discussion/poll-discussion.queries';
import type { EventPlanningPostCreator } from './event-planning-posts.create';
import type { EventPlanningPostsGateway } from './event-planning-posts.discord';
import { findLivePlanningPost } from './event-planning-posts.queries';
import { EventPlanningSubjectPosts } from './event-planning-posts.subjects';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

jest.mock('./event-planning-posts.queries', () => ({
  ...jest.requireActual<object>('./event-planning-posts.queries'),
  findLivePlanningPost: jest.fn(),
}));
jest.mock('../subject-discussion/poll-discussion.queries', () => ({
  findPollForSync: jest.fn(),
}));
jest.mock('./event-planning-posts.subjects.rules', () => ({
  ...jest.requireActual<object>('./event-planning-posts.subjects.rules'),
  pollEligible: jest.fn(() => true),
  planningSubjectBody: jest.fn(() => 'body'),
}));
jest.mock('./hub-forum-discord-subject', () => ({
  ...jest.requireActual<object>('./hub-forum-discord-subject'),
  pollPostTitle: jest.fn(() => 'WoW — Poll'),
}));
jest.mock('../../../settings/settings-bot.helpers', () => ({
  getClientUrl: jest.fn(() => Promise.resolve('https://rl')),
}));

const REF = { postId: 40, forumId: 1, discordThreadId: 'plan-post-9' };

function setup(created: boolean) {
  jest.mocked(findLivePlanningPost).mockResolvedValue(null);
  jest
    .mocked(findPollForSync)
    .mockResolvedValue({ lineupId: 3 } as unknown as Awaited<
      ReturnType<typeof findPollForSync>
    >);
  const creator = {
    create: jest.fn().mockResolvedValue({ created, ref: REF }),
  };
  const embedSync = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const subjects = new EventPlanningSubjectPosts(
    {} as unknown as ForumDiscordDb,
    {} as unknown as SettingsService,
    creator as unknown as EventPlanningPostCreator,
    {
      build: jest.fn().mockResolvedValue(null),
    } as unknown as SchedulingPollForumCard,
    embedSync as unknown as SchedulingPollEmbedQueueService,
    {} as unknown as EventPlanningPostsGateway,
  );
  const syncPoll = jest.spyOn(subjects, 'syncPoll').mockResolvedValue();
  return { subjects, creator, embedSync, syncPoll };
}

afterEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

describe('ROK-2295 Codex P2: ensurePollPost re-syncs the card after creating the post', () => {
  it('a created post ⇒ one coalesced embed sync for the poll, after the post is recorded', async () => {
    const { subjects, creator, embedSync } = setup(true);
    expect(await subjects.ensurePollPost(7)).toEqual(REF);
    expect(embedSync.enqueue).toHaveBeenCalledTimes(1);
    expect(embedSync.enqueue).toHaveBeenCalledWith(7);
    const [created] = creator.create.mock.invocationCallOrder;
    const [synced] = embedSync.enqueue.mock.invocationCallOrder;
    expect(synced).toBeGreaterThan(created ?? Infinity);
  });

  it('a post another caller created (not ours) ⇒ no extra sync', async () => {
    const { subjects, embedSync } = setup(false);
    expect(await subjects.ensurePollPost(7)).toEqual(REF);
    expect(embedSync.enqueue).not.toHaveBeenCalled();
  });
});
