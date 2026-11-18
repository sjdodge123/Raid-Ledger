/**
 * ROK-2208 review W1/M1 — `bind()` and `unbind(deleteForum)` go through the
 * per-Discord-guild serializer. Deterministic: the gateway's Discord calls
 * are held on a deferred, so a second caller that is NOT serialized reaches
 * the gateway while the first is still waiting (no timing races).
 */
import { HUB_FORUM_DISCORD_DEFAULT_CHANNEL_NAME as SHARED_NAME } from '@raid-ledger/contract';
import type {
  HubForumDiscordBindingSelect,
  HubForumDiscordForumSelect,
} from '../../../drizzle/schema';
import type { GuildActor } from '../../guild-access.service';
import type { HubForumDiscordRouteResolver } from './hub-forum-discord-route';
import type {
  ForumInfo,
  HubForumDiscordGateway,
} from './hub-forum-discord.gateway';
import * as queries from './hub-forum-discord.queries';
import type { HubForumDiscordDecor } from './hub-forum-discord-decor.apply';
import { HubForumDiscordService } from './hub-forum-discord.service';
import * as share from './hub-forum-discord.share';

jest.mock('./hub-forum-discord.queries');
jest.mock('./hub-forum-discord.share');
const q = jest.mocked(queries);
const s = jest.mocked(share);

const db = {} as unknown as queries.ForumDiscordDb;
const actor: GuildActor = { id: 1, role: 'admin' };
const SHARED = { ack: true, mode: 'create', target: 'shared' };

function deferred<T>() {
  let resolve: (v: T) => void = () => undefined;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** Let every already-resolved mock continuation run. */
const settle = () => new Promise((r) => setImmediate(r));

function forumInfo(id: string, name = SHARED_NAME): ForumInfo {
  const base = { id, name, tags: [], missing: [], canManage: true };
  return { ...base, isPublic: true, requireTag: false };
}

/** A tiny in-memory forums + bindings store behind the mocked queries. */
function fakeStore() {
  const forums: HubForumDiscordForumSelect[] = [];
  const binds: HubForumDiscordBindingSelect[] = [];
  q.upsertForum.mockImplementation((_db, row) => {
    const hit = forums.find((f) => f.channelId === row.channelId);
    if (hit) return Promise.resolve(hit);
    const made = {
      ...row,
      id: forums.length + 1,
      webhookId: null,
      webhookTokenEnc: null,
      requireTagSet: false,
      createdAt: new Date(0),
    };
    forums.push(made);
    return Promise.resolve(made);
  });
  q.insertBinding.mockImplementation((_db, row) => {
    binds.push({ ...row, tagId: row.tagId ?? null, ackBy: row.ackBy ?? null });
    return Promise.resolve();
  });
  q.findBinding.mockImplementation((_db, guildId) => {
    const binding = binds.find((b) => b.guildId === guildId);
    const forum = forums.find((f) => f.id === binding?.forumId);
    return Promise.resolve(binding && forum ? { binding, forum } : null);
  });
  q.listForumBindings.mockImplementation((_db, forumId) =>
    Promise.resolve(
      binds
        .filter((b) => b.forumId === forumId)
        .map((b) => ({ guildId: b.guildId, tagId: b.tagId, hubName: 'Hub' })),
    ),
  );
  q.deleteBinding.mockImplementation((_db, guildId) => {
    const at = binds.findIndex((b) => b.guildId === guildId);
    if (at >= 0) binds.splice(at, 1);
    return Promise.resolve();
  });
  q.inUseChannelIds.mockResolvedValue(new Set<string>());
  return { forums, binds };
}

/** Gateway whose `createForum` / `fetchForum` wait on test-held deferreds. */
function fakeGateway(store: ReturnType<typeof fakeStore>) {
  const created = deferred<ForumInfo>();
  const gw = {
    guildId: jest.fn(() => 'g1'),
    missingToCreate: jest.fn(() => []),
    createForum: jest.fn(() => created.promise),
    listForums: jest.fn(() => store.forums.map((f) => forumInfo(f.channelId))),
    fetchForum: jest.fn((id: string) => Promise.resolve(forumInfo(id))),
    ensureWebhook: jest.fn(() => Promise.resolve('wh1')),
    cachedForum: jest.fn(() => null),
    deleteForum: jest.fn(() => Promise.resolve()),
  };
  return { gw, created, gateway: gw as unknown as HubForumDiscordGateway };
}

function makeService(gateway: HubForumDiscordGateway) {
  const routes = { invalidate: jest.fn() };
  const resolver = routes as unknown as HubForumDiscordRouteResolver;
  const decor = {
    run: jest.fn(() => Promise.resolve('done')),
  } as unknown as HubForumDiscordDecor;
  return new HubForumDiscordService(db, gateway, resolver, decor);
}

beforeEach(() => {
  jest.resetAllMocks();
  s.shareForumTags.mockResolvedValue(null);
});

describe('HubForumDiscordService.bind — per-guild serializer (W1)', () => {
  it('a second shared bind waits for the first, then joins its ONE forum', async () => {
    const store = fakeStore();
    const { gw, created, gateway } = fakeGateway(store);
    const svc = makeService(gateway);

    const first = svc.bind(actor, 101, SHARED);
    const second = svc.bind(actor, 102, SHARED);
    await settle();
    // Hub 102 is queued behind hub 101's Discord create — it never looked.
    expect(gw.createForum).toHaveBeenCalledTimes(1);
    expect(gw.listForums).toHaveBeenCalledTimes(1);

    created.resolve(forumInfo('chan-1'));
    await Promise.all([first, second]);
    expect(gw.createForum).toHaveBeenCalledTimes(1);
    expect(store.forums.map((f) => f.channelId)).toEqual(['chan-1']);
    expect(store.binds.map((b) => [b.guildId, b.forumId])).toEqual([
      [101, 1],
      [102, 1],
    ]);
  });
});

describe('HubForumDiscordService.unbind — delete under the bind lock (M1)', () => {
  it('a bind joining the managed forum mid-unbind keeps it alive', async () => {
    const store = fakeStore();
    const { gw, created, gateway } = fakeGateway(store);
    const svc = makeService(gateway);
    const madeFirst = svc.bind(actor, 101, SHARED);
    created.resolve(forumInfo('chan-1'));
    await madeFirst;
    const held = deferred<ForumInfo>();
    gw.fetchForum.mockImplementationOnce(() => held.promise);

    const join = svc.bind(actor, 102, SHARED);
    await settle(); // hub 102 picked chan-1 and waits on Discord
    const leave = svc.unbind(101, true);
    await settle();
    expect(gw.deleteForum).not.toHaveBeenCalled();

    held.resolve(forumInfo('chan-1'));
    await Promise.all([join, leave]);
    expect(gw.deleteForum).not.toHaveBeenCalled();
    expect(store.binds.map((b) => b.guildId)).toEqual([102]);
  });

  it('still deletes a managed forum nobody binds any more', async () => {
    const store = fakeStore();
    const { gw, created, gateway } = fakeGateway(store);
    const svc = makeService(gateway);
    const bound = svc.bind(actor, 101, SHARED);
    created.resolve(forumInfo('chan-1'));
    await bound;
    await svc.unbind(101, true);
    expect(gw.deleteForum).toHaveBeenCalledWith('chan-1');
    expect(q.deleteForumRow).toHaveBeenCalledWith(db, 1);
  });
});
