/**
 * ROK-2272 S10 — the non-hub poll / lineup planning-post listener (unit).
 */
import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { findPollMatchIds } from '../subject-discussion/poll-discussion.queries';
import type { EventPlanningSubjectPosts } from './event-planning-posts.subjects';
import { EventPlanningSubjectsListener } from './event-planning-subjects.listener';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));
jest.mock('../subject-discussion/poll-discussion.queries', () => ({
  findPollMatchIds: jest.fn(),
}));

const matchIds = jest.mocked(findPollMatchIds);

function setup() {
  const subjects = {
    ensurePollPost: jest.fn().mockResolvedValue(null),
    ensureLineupPost: jest.fn().mockResolvedValue(null),
    syncPoll: jest.fn().mockResolvedValue(undefined),
    syncLineup: jest.fn().mockResolvedValue(undefined),
  };
  const listener = new EventPlanningSubjectsListener(
    {} as unknown as ForumDiscordDb,
    subjects as unknown as EventPlanningSubjectPosts,
  );
  return { listener, subjects };
}

beforeEach(() => {
  matchIds.mockResolvedValue([]);
});

afterEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

describe('EventPlanningSubjectsListener', () => {
  it('declares the same Core hub behaviour as the event listener', () => {
    const { listener } = setup();
    expect(listener.hubBehaviour).toBe('event-planning.discord-posts');
    expect(listener.ownerPluginId).toBe('core');
  });

  it('a committed vote ensures the poll post', async () => {
    const { listener, subjects } = setup();
    await listener.onPollVoted({
      matchId: 7,
      lineupId: 3,
      userId: 1,
      stance: 'yes',
    });
    expect(subjects.ensurePollPost).toHaveBeenCalledWith(7);
  });

  it('a cleared tap (stance null) creates nothing', async () => {
    const { listener, subjects } = setup();
    await listener.onPollVoted({
      matchId: 7,
      lineupId: 3,
      userId: 1,
      stance: null,
    });
    expect(subjects.ensurePollPost).not.toHaveBeenCalled();
  });

  it.each(['onLockedIn', 'onCancelled', 'onEnteredScheduling'] as const)(
    '%s re-syncs the poll post and never creates one',
    async (handler) => {
      const { listener, subjects } = setup();
      await listener[handler]({ matchId: 7 });
      expect(subjects.syncPoll).toHaveBeenCalledWith(7);
      expect(subjects.ensurePollPost).not.toHaveBeenCalled();
    },
  );

});

describe('EventPlanningSubjectsListener lineup emits', () => {
  it('onDecided re-syncs the lineup post only', async () => {
    const { listener, subjects } = setup();
    await listener.onDecided({ lineupId: 3 });
    expect(subjects.syncLineup).toHaveBeenCalledWith(3);
    expect(subjects.ensureLineupPost).not.toHaveBeenCalled();
  });

  it('building → voting creates the lineup post, then syncs it and its polls', async () => {
    const { listener, subjects } = setup();
    matchIds.mockResolvedValue([11, 12]);
    await listener.onStatusChanged({
      lineupId: 3,
      from: 'building',
      to: 'voting',
      standalone: false,
    });
    expect(subjects.ensureLineupPost).toHaveBeenCalledWith(3);
    expect(subjects.syncLineup).toHaveBeenCalledWith(3);
    expect(subjects.syncPoll.mock.calls).toEqual([[11], [12]]);
  });

  it('other edges only sync', async () => {
    const { listener, subjects } = setup();
    await listener.onStatusChanged({
      lineupId: 3,
      from: 'voting',
      to: 'archived',
      standalone: false,
    });
    expect(subjects.ensureLineupPost).not.toHaveBeenCalled();
    expect(subjects.syncLineup).toHaveBeenCalledWith(3);
  });

  it('a standalone carrier never gets a lineup post but its polls still sync', async () => {
    const { listener, subjects } = setup();
    matchIds.mockResolvedValue([21]);
    await listener.onStatusChanged({
      lineupId: 4,
      from: 'building',
      to: 'voting',
      standalone: true,
    });
    expect(subjects.ensureLineupPost).not.toHaveBeenCalled();
    expect(subjects.syncPoll).toHaveBeenCalledWith(21);
  });

});

describe('EventPlanningSubjectsListener failure handling', () => {
  it('ignores a payload with no id', async () => {
    const { listener, subjects } = setup();
    await listener.onPollVoted({ stance: 'yes' });
    await listener.onLockedIn(null);
    expect(subjects.ensurePollPost).not.toHaveBeenCalled();
    expect(subjects.syncPoll).not.toHaveBeenCalled();
  });

  it('swallows a handler error (warn + Sentry), never throws into the emitter', async () => {
    const { listener, subjects } = setup();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    subjects.ensurePollPost.mockRejectedValueOnce(new Error('discord down'));
    await expect(
      listener.onPollVoted({ matchId: 7, stance: 'yes' }),
    ).resolves.toBeUndefined();
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { event_planning_posts: 'poll-voted' },
    });
  });

  it('one failing poll sync does not stop the rest', async () => {
    const { listener, subjects } = setup();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    matchIds.mockResolvedValue([1, 2]);
    subjects.syncPoll.mockRejectedValueOnce(new Error('db'));
    await listener.onStatusChanged({ lineupId: 3, to: 'archived' });
    expect(subjects.syncPoll).toHaveBeenCalledTimes(2);
  });
});
