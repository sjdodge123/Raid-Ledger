/**
 * ROK-2287 — `ensureMissingLineupPosts` (unit): no resolved forum → no
 * query; otherwise the candidate query is asked for the batch in THAT forum,
 * each id goes through `ensureLineupPost`, and one failing lineup is warned
 * while the rest still run.
 */
import { Logger } from '@nestjs/common';
import type { SettingsService } from '../../../settings/settings.service';
import type { EventPlanningPostCreator } from './event-planning-posts.create';
import { findVotingLineupsWithoutPlanningPost } from './event-planning-posts.queries';
import {
  EventPlanningSubjectPosts,
  LINEUP_CATCH_UP_BATCH,
} from './event-planning-posts.subjects';
import type { PollRescheduleCrosslink } from './poll-reschedule-crosslink';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

jest.mock('./event-planning-posts.queries', () => ({
  ...jest.requireActual<object>('./event-planning-posts.queries'),
  findVotingLineupsWithoutPlanningPost: jest.fn(),
}));

const candidates = jest.mocked(findVotingLineupsWithoutPlanningPost);
const db = {} as unknown as ForumDiscordDb;

const FORUM = { forumId: 77, channelId: 'c1', managed: true, webhookId: null };

function setup(forum: typeof FORUM | null = FORUM) {
  const creator = { resolveForum: jest.fn().mockResolvedValue(forum) };
  const subjects = new EventPlanningSubjectPosts(
    db,
    {} as unknown as SettingsService,
    creator as unknown as EventPlanningPostCreator,
    { linkPollPost: jest.fn() } as unknown as PollRescheduleCrosslink,
  );
  const ensure = jest
    .spyOn(subjects, 'ensureLineupPost')
    .mockResolvedValue(null);
  return { subjects, ensure };
}

afterEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

describe('EventPlanningSubjectPosts.ensureMissingLineupPosts', () => {
  it('asks for the newest 10 candidates and ensures each one', async () => {
    const { subjects, ensure } = setup();
    candidates.mockResolvedValue([9, 4]);
    const now = new Date('2026-11-21T06:00:00Z');
    expect(await subjects.ensureMissingLineupPosts(now)).toBe(2);
    expect(LINEUP_CATCH_UP_BATCH).toBe(10);
    expect(candidates).toHaveBeenCalledWith(
      db,
      FORUM.forumId,
      now,
      LINEUP_CATCH_UP_BATCH,
    );
    expect(ensure.mock.calls).toEqual([[9], [4]]);
  });

  it('no resolved forum (none bound / offline) → no query, nothing ensured', async () => {
    const { subjects, ensure } = setup(null);
    expect(await subjects.ensureMissingLineupPosts()).toBe(0);
    expect(candidates).not.toHaveBeenCalled();
    expect(ensure).not.toHaveBeenCalled();
  });

  it('no candidates → nothing ensured', async () => {
    const { subjects, ensure } = setup();
    candidates.mockResolvedValue([]);
    expect(await subjects.ensureMissingLineupPosts()).toBe(0);
    expect(ensure).not.toHaveBeenCalled();
  });

  it('one failing lineup is warned; the rest still run', async () => {
    const { subjects, ensure } = setup();
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    candidates.mockResolvedValue([3, 2, 1]);
    ensure.mockRejectedValueOnce(new Error('discord down'));
    expect(await subjects.ensureMissingLineupPosts()).toBe(2);
    expect(ensure.mock.calls).toEqual([[3], [2], [1]]);
    expect(warn).toHaveBeenCalledWith(
      'Planning post catch-up of lineup 3 failed: discord down',
    );
  });
});
