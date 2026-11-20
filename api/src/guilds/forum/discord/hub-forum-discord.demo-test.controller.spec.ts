/**
 * ROK-2272 S4b — the two DEMO_MODE fixtures the event-planning smoke uses:
 * `sync-planning-post` (re-sync one event's planning post) and `lock-sweep`
 * (run the Core lock sweep at the REAL current time). Plus the class-level
 * guard chain every `/admin/test/*` controller must keep.
 */
import { NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import * as schema from '../../../drizzle/schema';
import { DemoModeGuard } from '../../../admin/demo-mode.guard';
import { AdminGuard } from '../../../auth/admin.guard';
import type { EventPlanningPostsService } from './event-planning-posts.service';
import type { HubForumDiscordEventLockSweep } from './hub-forum-discord-event-lock';
import type { HubForumDiscordSignupPings } from './hub-forum-discord-signup-pings.service';
import type { HubForumDiscordGateway } from './hub-forum-discord.gateway';
import type { ForumDiscordDb } from './hub-forum-discord.queries';
import type { EventPlanningSubjectPosts } from './event-planning-posts.subjects';
import {
  findLivePlanningPost,
  setPlanningPostClosesAt,
} from './event-planning-posts.queries';
import { HubForumDiscordDemoTestController } from './hub-forum-discord.demo-test.controller';

jest.mock('./event-planning-posts.queries', () => ({
  findLivePlanningPost: jest.fn(),
  setPlanningPostClosesAt: jest.fn(),
}));
const findPost = jest.mocked(findLivePlanningPost);
const setClosesAt = jest.mocked(setPlanningPostClosesAt);

function build() {
  const syncEvent = jest.fn().mockResolvedValue(undefined);
  const sweep = jest.fn().mockResolvedValue(3);
  const controller = new HubForumDiscordDemoTestController(
    {} as ForumDiscordDb,
    {} as HubForumDiscordGateway,
    {} as HubForumDiscordSignupPings,
    { syncEvent } as unknown as EventPlanningPostsService,
    { sweep } as unknown as HubForumDiscordEventLockSweep,
    {} as EventPlanningSubjectPosts,
  );
  return { controller, syncEvent, sweep };
}

describe('HubForumDiscordDemoTestController (ROK-2272 S4b fixtures)', () => {
  it('stays behind the JWT, admin and DEMO_MODE guards, DEMO_MODE last', () => {
    const guards: unknown = Reflect.getMetadata(
      GUARDS_METADATA,
      HubForumDiscordDemoTestController,
    );
    expect(Array.isArray(guards)).toBe(true);
    const list = guards as unknown[];
    expect(list).toHaveLength(3);
    expect(list[1]).toBe(AdminGuard);
    expect(list[2]).toBe(DemoModeGuard);
  });

  it('sync-planning-post re-syncs exactly that event', async () => {
    const { controller, syncEvent } = build();
    await expect(controller.syncPlanningPost(42)).resolves.toEqual({
      synced: true,
    });
    expect(syncEvent).toHaveBeenCalledTimes(1);
    expect(syncEvent).toHaveBeenCalledWith(42);
  });

  it('lock-sweep runs the sweep at the real current time and reports changes', async () => {
    const { controller, sweep } = build();
    await expect(controller.lockSweepNow()).resolves.toEqual({ changed: 3 });
    expect(sweep).toHaveBeenCalledTimes(1);
    // No caller-supplied "now": the sweep's own default (new Date()) applies.
    expect(sweep).toHaveBeenCalledWith();
  });
});

describe('close-discussion-now (ROK-2272 S8 fixture)', () => {
  function withDb(rows: { id: number }[]) {
    const returning = jest.fn().mockResolvedValue(rows);
    const where = jest.fn().mockReturnValue({ returning });
    const set = jest.fn().mockReturnValue({ where });
    const update = jest.fn().mockReturnValue({ set });
    const controller = new HubForumDiscordDemoTestController(
      { update } as unknown as ForumDiscordDb,
      {} as HubForumDiscordGateway,
      {} as HubForumDiscordSignupPings,
      {} as EventPlanningPostsService,
      {} as HubForumDiscordEventLockSweep,
      {} as EventPlanningSubjectPosts,
    );
    return { controller, update, set, where };
  }

  it('moves the poll thread write window to just before now', async () => {
    const { controller, update, set, where } = withDb([{ id: 9 }]);
    const before = Date.now();
    await expect(controller.closeDiscussionNow(77)).resolves.toEqual({
      closed: 1,
    });
    expect(update).toHaveBeenCalledWith(schema.hubForumThreads);
    expect(where).toHaveBeenCalledTimes(1);
    const arg: unknown = set.mock.calls[0]?.[0];
    const at =
      typeof arg === 'object' && arg !== null && 'writeClosesAt' in arg
        ? arg.writeClosesAt
        : null;
    expect(at).toBeInstanceOf(Date);
    const ms = at instanceof Date ? at.getTime() : Number.NaN;
    expect(ms).toBeLessThan(before);
    expect(ms).toBeGreaterThan(before - 60_000);
  });

  it('404s a poll with no thread instead of reporting success', async () => {
    const { controller } = withDb([]);
    await expect(controller.closeDiscussionNow(77)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('non-hub poll planning post fixtures (ROK-2272 S10)', () => {
  const db = {} as ForumDiscordDb;
  function build() {
    const syncPoll = jest.fn().mockResolvedValue(undefined);
    const controller = new HubForumDiscordDemoTestController(
      db,
      {} as HubForumDiscordGateway,
      {} as HubForumDiscordSignupPings,
      {} as EventPlanningPostsService,
      {} as HubForumDiscordEventLockSweep,
      { syncPoll } as unknown as EventPlanningSubjectPosts,
    );
    return { controller, syncPoll };
  }

  beforeEach(() => jest.clearAllMocks());

  it('sync-planning-post re-syncs exactly that poll at the real time', async () => {
    const { controller, syncPoll } = build();
    const before = Date.now();
    await expect(controller.syncPollPlanningPost(31)).resolves.toEqual({
      synced: true,
    });
    expect(syncPoll).toHaveBeenCalledTimes(1);
    expect(syncPoll.mock.calls[0]?.[0]).toBe(31);
    const now: unknown = syncPoll.mock.calls[0]?.[1];
    expect(now).toBeInstanceOf(Date);
    expect(now instanceof Date ? now.getTime() : 0).toBeGreaterThanOrEqual(
      before,
    );
  });

  it('close-planning-post-now moves the live poll post closes_at to just before now', async () => {
    const { controller } = build();
    findPost.mockResolvedValue({ id: 12 } as never);
    const before = Date.now();
    await expect(controller.closePlanningPostNow(31)).resolves.toEqual({
      postId: 12,
    });
    expect(findPost).toHaveBeenCalledWith(db, 'poll', 31);
    expect(setClosesAt).toHaveBeenCalledTimes(1);
    expect(setClosesAt.mock.calls[0]?.[1]).toBe(12);
    const at: unknown = setClosesAt.mock.calls[0]?.[2];
    expect(at).toBeInstanceOf(Date);
    const ms = at instanceof Date ? at.getTime() : Number.NaN;
    expect(ms).toBeLessThan(before);
    expect(ms).toBeGreaterThan(before - 60_000);
  });

  it('close-planning-post-now 404s a poll with no live planning post', async () => {
    const { controller } = build();
    findPost.mockResolvedValue(null);
    await expect(controller.closePlanningPostNow(31)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(setClosesAt).not.toHaveBeenCalled();
  });
});
