/**
 * ROK-2292 D8 — the announce listener creates the event's forum post (hub
 * or registry) once its announcement embed is posted, leaves an existing
 * registry post alone, and never throws into the poster.
 */
import type { ForumDiscordDb } from './hub-forum-discord.queries';
import type { EventPlanningPostsService } from './event-planning-posts.service';
import type { HubForumDiscordOutboundService } from './hub-forum-discord-outbound.service';
import type {
  HubPingThreadRef,
  PlanningPingThreadRef,
} from './hub-forum-discord-signup-pings.queries';
import { resolvePingThread } from './hub-forum-discord-signup-pings.target';
import { HubForumDiscordAnnounceListener } from './hub-forum-discord-announce.listener';

jest.mock('./hub-forum-discord-signup-pings.target', () => ({
  resolvePingThread: jest.fn(),
}));

const resolve = jest.mocked(resolvePingThread);
const ENDS = new Date('2026-11-30T20:00:00Z');
const DB: ForumDiscordDb = Object.create(null);

function hubRef(over: Partial<HubPingThreadRef> = {}): HubPingThreadRef {
  return {
    kind: 'hub',
    guildId: 7,
    threadId: 3,
    endsAt: ENDS,
    cancelled: false,
    ...over,
  };
}

function planningRef(
  over: Partial<PlanningPingThreadRef> = {},
): PlanningPingThreadRef {
  return {
    kind: 'planning',
    eventId: 42,
    post: null,
    endsAt: ENDS,
    cancelled: false,
    ...over,
  };
}

function build() {
  const outbound = { ensureEventPost: jest.fn().mockResolvedValue(null) };
  const planning = { ensureEventPost: jest.fn().mockResolvedValue(null) };
  const listener = new HubForumDiscordAnnounceListener(
    DB,
    outbound as unknown as HubForumDiscordOutboundService,
    planning as unknown as EventPlanningPostsService,
  );
  return { outbound, planning, listener };
}

describe('HubForumDiscordAnnounceListener (ROK-2292 D8)', () => {
  beforeEach(() => resolve.mockReset());

  it('a hub event: creates its hub post through the binding-checked ensure', async () => {
    resolve.mockResolvedValue(hubRef());
    const { outbound, planning, listener } = build();
    await listener.onAnnounced({ eventId: 42 });
    expect(resolve).toHaveBeenCalledWith(DB, 42);
    expect(outbound.ensureEventPost).toHaveBeenCalledWith({
      guildId: 7,
      threadId: 3,
      create: true,
    });
    expect(planning.ensureEventPost).not.toHaveBeenCalled();
  });

  it('a non-hub event with no registry post: creates the registry post', async () => {
    resolve.mockResolvedValue(planningRef());
    const { outbound, planning, listener } = build();
    await listener.onAnnounced({ eventId: 42 });
    expect(planning.ensureEventPost).toHaveBeenCalledWith(42);
    expect(outbound.ensureEventPost).not.toHaveBeenCalled();
  });

  it('a registry post that already exists (even locked) is left alone', async () => {
    const post = { id: 5, discordThreadId: 'th-5', locked: true };
    resolve.mockResolvedValue(planningRef({ post }));
    const { outbound, planning, listener } = build();
    await listener.onAnnounced({ eventId: 42 });
    expect(planning.ensureEventPost).not.toHaveBeenCalled();
    expect(outbound.ensureEventPost).not.toHaveBeenCalled();
  });

  it('no target (hub unbound, ad-hoc) or a cancelled event: nothing is created', async () => {
    const { outbound, planning, listener } = build();
    resolve.mockResolvedValueOnce(null);
    await listener.onAnnounced({ eventId: 42 });
    resolve.mockResolvedValueOnce(hubRef({ cancelled: true }));
    await listener.onAnnounced({ eventId: 42 });
    resolve.mockResolvedValueOnce(planningRef({ cancelled: true }));
    await listener.onAnnounced({ eventId: 42 });
    expect(outbound.ensureEventPost).not.toHaveBeenCalled();
    expect(planning.ensureEventPost).not.toHaveBeenCalled();
  });

  it('a failing create is logged, never thrown into the poster', async () => {
    resolve.mockResolvedValue(hubRef());
    const { outbound, listener } = build();
    outbound.ensureEventPost.mockRejectedValue(new Error('discord down'));
    await expect(
      listener.onAnnounced({ eventId: 42 }),
    ).resolves.toBeUndefined();
  });
});
