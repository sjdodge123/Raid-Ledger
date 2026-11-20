/**
 * ROK-2272 §3.2 — the event-planning forum rule (0/1/≥2 bound forums, stale
 * pick, R3 fallback) and the resolver's 60 s cache + invalidate hook.
 */
import { SETTING_KEYS } from '../../../drizzle/schema';
import type { SettingsService } from '../../../settings/settings.service';
import * as queries from './event-planning-forum.queries';
import type { BoundForum } from './event-planning-forum.queries';
import {
  EVENT_PLANNING_FORUM_AMBIGUOUS,
  EVENT_PLANNING_FORUM_UNKNOWN,
  EventPlanningForumResolver,
  pickEventPlanningForum,
} from './event-planning-forum.resolver';
import type { HubForumDiscordGateway } from './hub-forum-discord.gateway';
import { HubForumDiscordModule } from './hub-forum-discord.module';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

jest.mock('./event-planning-forum.queries');
const q = jest.mocked(queries);

const forum = (forumId: number, managed = false): BoundForum => ({
  forumId,
  channelId: `10000000000000000${forumId}`,
  managed,
  webhookId: null,
});
const A = forum(1);
const B = forum(2);
const M = forum(3, true);
const M2 = forum(4, true);

/** Channel names as the Discord cache would report them. */
const names =
  (map: Record<string, string>) =>
  (channelId: string): string | null =>
    map[channelId] ?? null;
const noNames = names({});

describe('pickEventPlanningForum (§3.2)', () => {
  it('0 bound forums ⇒ no forum, no warning', () => {
    expect(
      pickEventPlanningForum([], { pickedChannelId: null, nameOf: noNames }),
    ).toEqual({ forum: null, warning: null });
  });

  it('exactly 1 ⇒ that forum, even when the setting names another', () => {
    expect(
      pickEventPlanningForum([A], {
        pickedChannelId: B.channelId,
        nameOf: noNames,
      }),
    ).toEqual({ forum: A, warning: null });
  });

  it('≥2 ⇒ the forum the setting picks while it is still bound', () => {
    expect(
      pickEventPlanningForum([A, B], {
        pickedChannelId: B.channelId,
        nameOf: noNames,
      }),
    ).toEqual({ forum: B, warning: null });
  });

  it('≥2 + a stale pick + no managed event-planning ⇒ none + warning', () => {
    expect(
      pickEventPlanningForum([A, B], {
        pickedChannelId: '999999999999999999',
        nameOf: noNames,
      }),
    ).toEqual({ forum: null, warning: EVENT_PLANNING_FORUM_AMBIGUOUS });
  });

  it('R3: ≥2 + unset ⇒ the one managed forum named event-planning', () => {
    const nameOf = names({ [M.channelId]: 'event-planning' });
    expect(
      pickEventPlanningForum([A, M], { pickedChannelId: null, nameOf }),
    ).toEqual({ forum: M, warning: null });
  });

  it('R3 never picks an operator-named (unmanaged) event-planning forum', () => {
    const nameOf = names({ [A.channelId]: 'event-planning' });
    expect(
      pickEventPlanningForum([A, B], { pickedChannelId: null, nameOf }),
    ).toEqual({ forum: null, warning: EVENT_PLANNING_FORUM_AMBIGUOUS });
  });

  it('R3: two managed event-planning forums ⇒ none + warning', () => {
    const nameOf = names({
      [M.channelId]: 'event-planning',
      [M2.channelId]: 'event-planning',
    });
    expect(
      pickEventPlanningForum([M, M2], { pickedChannelId: null, nameOf }),
    ).toEqual({ forum: null, warning: EVENT_PLANNING_FORUM_AMBIGUOUS });
  });
});

describe('pickEventPlanningForum (§3.2, review: precedence + unknown)', () => {
  it('≥2 ⇒ a valid pick wins over a managed event-planning forum', () => {
    const nameOf = names({ [M.channelId]: 'event-planning' });
    expect(
      pickEventPlanningForum([A, M], { pickedChannelId: A.channelId, nameOf }),
    ).toEqual({ forum: A, warning: null });
  });

  it('R3: a managed forum whose name cannot be read ⇒ none + unknown', () => {
    expect(
      pickEventPlanningForum([A, M], {
        pickedChannelId: null,
        nameOf: () => undefined,
      }),
    ).toEqual({ forum: null, warning: EVENT_PLANNING_FORUM_UNKNOWN });
  });

  it('R3: unreadable names of unmanaged forums only ⇒ ambiguous', () => {
    expect(
      pickEventPlanningForum([A, B], {
        pickedChannelId: null,
        nameOf: () => undefined,
      }),
    ).toEqual({ forum: null, warning: EVENT_PLANNING_FORUM_AMBIGUOUS });
  });

  it('R3: a managed forum under another name is not the fallback', () => {
    const nameOf = names({ [M.channelId]: 'hub-forums' });
    expect(
      pickEventPlanningForum([A, M], { pickedChannelId: null, nameOf }),
    ).toEqual({ forum: null, warning: EVENT_PLANNING_FORUM_AMBIGUOUS });
  });
});

const GUILD = '200000000000000001';

/** A resolver over stubbed settings (pick B) + an online gateway, no names. */
function build() {
  jest.resetAllMocks();
  q.loadBoundForums.mockResolvedValue([A, B]);
  const settings = {
    get: jest.fn(() => Promise.resolve<string | null>(B.channelId)),
  };
  const gateway = {
    cachedForum: jest.fn<{ name: string } | null, [string]>(() => null),
    guildId: jest.fn((): string | null => GUILD),
  };
  const resolver = new EventPlanningForumResolver(
    {} as unknown as ForumDiscordDb,
    settings as unknown as SettingsService,
    gateway as unknown as HubForumDiscordGateway,
  );
  return { settings, gateway, resolver };
}

describe('EventPlanningForumResolver (60 s cache)', () => {
  let settings: ReturnType<typeof build>['settings'];
  let gateway: ReturnType<typeof build>['gateway'];
  let resolver: EventPlanningForumResolver;

  beforeEach(() => {
    ({ settings, gateway, resolver } = build());
  });

  it('reads the bound forums and the setting key, returning the pick', async () => {
    const res = await resolver.resolve(GUILD, 0);
    expect(res).toEqual({ forum: B, candidates: [A, B], warning: null });
    expect(q.loadBoundForums).toHaveBeenCalledWith(expect.anything(), GUILD);
    expect(settings.get).toHaveBeenCalledWith(
      SETTING_KEYS.DISCORD_BOT_EVENT_PLANNING_FORUM,
    );
  });

  it('serves the cache inside 60 s and reloads after it', async () => {
    await resolver.resolve(GUILD, 0);
    await resolver.resolve(GUILD, 59_999);
    expect(q.loadBoundForums).toHaveBeenCalledTimes(1);
    await resolver.resolve(GUILD, 60_000);
    expect(q.loadBoundForums).toHaveBeenCalledTimes(2);
  });

  it('invalidate() drops the cache (bind/unbind/setting change)', async () => {
    await resolver.resolve(GUILD, 0);
    q.loadBoundForums.mockResolvedValue([A]);
    resolver.invalidate();
    const res = await resolver.resolve(GUILD, 1);
    expect(res.forum).toEqual(A);
    expect(q.loadBoundForums).toHaveBeenCalledTimes(2);
  });

  it('R3 reads the live channel name from the gateway cache', async () => {
    q.loadBoundForums.mockResolvedValue([A, M]);
    settings.get.mockResolvedValue(null);
    gateway.cachedForum.mockImplementation((id: string) =>
      id === M.channelId ? { name: 'event-planning' } : null,
    );
    const res = await resolver.resolve(GUILD, 0);
    expect(res.forum).toEqual(M);
  });
});

describe('EventPlanningForumResolver (review MAJOR: cold cache)', () => {
  let settings: ReturnType<typeof build>['settings'];
  let gateway: ReturnType<typeof build>['gateway'];
  let resolver: EventPlanningForumResolver;

  beforeEach(() => {
    ({ settings, gateway, resolver } = build());
  });

  it('offline gateway ⇒ unknown, never cached; resolves once the cache warms', async () => {
    q.loadBoundForums.mockResolvedValue([A, M]);
    settings.get.mockResolvedValue(null);
    gateway.guildId.mockReturnValue(null);
    const cold = await resolver.resolve(GUILD, 0);
    expect(cold).toEqual({
      forum: null,
      candidates: [A, M],
      warning: EVENT_PLANNING_FORUM_UNKNOWN,
    });
    gateway.guildId.mockReturnValue(GUILD);
    gateway.cachedForum.mockImplementation((id: string) =>
      id === M.channelId ? { name: 'event-planning' } : null,
    );
    const warm = await resolver.resolve(GUILD, 1);
    expect(warm).toEqual({ forum: M, candidates: [A, M], warning: null });
    expect(q.loadBoundForums).toHaveBeenCalledTimes(2);
    await resolver.resolve(GUILD, 2);
    expect(q.loadBoundForums).toHaveBeenCalledTimes(2);
  });

  it('an invalidate() during a read keeps that stale read out of the cache', async () => {
    settings.get.mockImplementation(() => {
      resolver.invalidate(); // a bind lands while this read is in flight
      return Promise.resolve(B.channelId);
    });
    await resolver.resolve(GUILD, 0);
    await resolver.resolve(GUILD, 1);
    expect(q.loadBoundForums).toHaveBeenCalledTimes(2);
  });
});

describe('HubForumDiscordModule', () => {
  it('exports EventPlanningForumResolver (S4 + S5a inject it)', () => {
    const exported: unknown = Reflect.getMetadata(
      'exports',
      HubForumDiscordModule,
    );
    expect(exported).toEqual(
      expect.arrayContaining([EventPlanningForumResolver]),
    );
  });
});
