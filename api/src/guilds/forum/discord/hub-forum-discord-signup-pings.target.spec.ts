/**
 * ROK-2314 review MINOR-2 — the signup-flush post resolvers treat an event
 * that is mid-reschedule as closed, even before the lock sweep has locked
 * its post (hub or registry), and create no post for it.
 */
import type { EventPlanningPostsService } from './event-planning-posts.service';
import type { HubForumDiscordOutboundService } from './hub-forum-discord-outbound.service';
import type {
  HubPingThreadRef,
  PlanningPingThreadRef,
} from './hub-forum-discord-signup-pings.queries';
import {
  resolveHubPost,
  resolvePlanningPost,
} from './hub-forum-discord-signup-pings.target';

const TIMING = { endsAt: new Date('2099-01-01T00:00:00Z'), cancelled: false };
const HUB_REF: HubPingThreadRef = {
  ...TIMING,
  kind: 'hub',
  guildId: 3,
  threadId: 8,
};
const LIVE_LINK = {
  id: 5,
  discordThreadId: 'd-thread',
  // A sent post (`links.isUnsent` reads it; an `rl:` id would be 'pending').
  discordMessageId: 'd-thread',
  discordDeletedAt: null,
  discordLockedAt: null,
};

function planningRef(locked: boolean | null): PlanningPingThreadRef {
  const post =
    locked === null ? null : { id: 11, discordThreadId: 'd-post', locked };
  return { ...TIMING, kind: 'planning', eventId: 42, post };
}

function outboundWith(): {
  outbound: HubForumDiscordOutboundService;
  ensureEventPost: jest.Mock;
} {
  const ensureEventPost = jest.fn().mockResolvedValue(LIVE_LINK);
  const outbound = {
    ensureEventPost,
  } as unknown as HubForumDiscordOutboundService;
  return { outbound, ensureEventPost };
}

function planningWith(): {
  planning: EventPlanningPostsService;
  ensureEventPost: jest.Mock;
} {
  const ensureEventPost = jest
    .fn()
    .mockResolvedValue({ postId: 12, discordThreadId: 'd-new' });
  const planning = { ensureEventPost } as unknown as EventPlanningPostsService;
  return { planning, ensureEventPost };
}

const rescheduling = (): Promise<boolean> => Promise.resolve(true);
const settled = (): Promise<boolean> => Promise.resolve(false);

describe('resolveHubPost — reschedule poll running (ROK-2314)', () => {
  it('is closed and creates nothing while the event is rescheduling', async () => {
    const { outbound, ensureEventPost } = outboundWith();
    await expect(
      resolveHubPost(outbound, HUB_REF, true, rescheduling),
    ).resolves.toBe('closed');
    expect(ensureEventPost).not.toHaveBeenCalled();
  });

  it('writes in the unlocked post once the poll ended', async () => {
    const { outbound } = outboundWith();
    await expect(
      resolveHubPost(outbound, HUB_REF, true, settled),
    ).resolves.toEqual({
      discordThreadId: 'd-thread',
      scope: { guildId: 3, threadId: 8 },
      linkId: 5,
    });
  });
});

describe('resolvePlanningPost — reschedule poll running (ROK-2314)', () => {
  it('is closed for an unlocked post while the event is rescheduling', async () => {
    const { planning } = planningWith();
    const reopen = jest.fn();
    await expect(
      resolvePlanningPost(
        planning,
        reopen,
        planningRef(false),
        true,
        rescheduling,
      ),
    ).resolves.toBe('closed');
    expect(reopen).not.toHaveBeenCalled();
  });

  it('creates no post while the event is rescheduling', async () => {
    const { planning, ensureEventPost } = planningWith();
    await expect(
      resolvePlanningPost(
        planning,
        jest.fn(),
        planningRef(null),
        true,
        rescheduling,
      ),
    ).resolves.toBe('closed');
    expect(ensureEventPost).not.toHaveBeenCalled();
  });

  it('writes in the unlocked post once the poll ended', async () => {
    const { planning } = planningWith();
    await expect(
      resolvePlanningPost(
        planning,
        jest.fn(),
        planningRef(false),
        true,
        settled,
      ),
    ).resolves.toEqual({
      discordThreadId: 'd-post',
      scope: { planningPostId: 11 },
    });
  });
});
