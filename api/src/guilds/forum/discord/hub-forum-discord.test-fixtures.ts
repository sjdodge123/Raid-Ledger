/**
 * ROK-2208 L2b — an in-memory Discord behind `HubForumDiscordGateway`, for the
 * binding integration spec. The gateway is the service's only Discord seam
 * (plain data in and out), so the spec spies on the singleton instance the
 * app holds (never a `jest.mock` — it would not reach the app).
 * Excluded from `nest build` by the `*.test-fixtures.ts` pattern.
 */
import type { TestApp } from '../../../common/testing/test-app';
import {
  HubForumDiscordGateway,
  type ForumInfo,
} from './hub-forum-discord.gateway';

/** The connected Discord guild every fake forum lives in. */
export const FAKE_DISCORD_GUILD = '478870000000000900';

let snow = 0;
const runTag = String(Date.now()).slice(-7);

/** A fresh 18-digit snowflake; specs never share channel or tag ids. */
export const snowflake = (): string =>
  `4788${runTag}${String((snow += 1)).padStart(7, '0')}`;

/** A forum in the fake guild; `missing` / `canManage` drive the preflight. */
export function fakeForum(over: Partial<ForumInfo> = {}): ForumInfo {
  return {
    id: snowflake(),
    name: 'hub-forums',
    tags: [],
    missing: [],
    canManage: true,
    isPublic: true,
    requireTag: false,
    ...over,
  };
}

type Forums = Map<string, ForumInfo>;
interface FakeState {
  online: boolean;
  missingToCreate: string[];
}

const copy = (f: ForumInfo): ForumInfo => ({ ...f, tags: [...f.tags] });
const copyOf = (f: ForumInfo | undefined) => (f ? copy(f) : null);

/** Reads: the connected guild and the forums it holds. */
function readSpies(
  gw: HubForumDiscordGateway,
  forums: Forums,
  state: FakeState,
) {
  return {
    guildId: jest
      .spyOn(gw, 'guildId')
      .mockImplementation(() => (state.online ? FAKE_DISCORD_GUILD : null)),
    listForums: jest
      .spyOn(gw, 'listForums')
      .mockImplementation(() => [...forums.values()].map(copy)),
    cachedForum: jest
      .spyOn(gw, 'cachedForum')
      .mockImplementation((id) => copyOf(forums.get(id))),
    fetchForum: jest
      .spyOn(gw, 'fetchForum')
      .mockImplementation((id) => Promise.resolve(copyOf(forums.get(id)))),
    missingToCreate: jest
      .spyOn(gw, 'missingToCreate')
      .mockImplementation(() => [...state.missingToCreate]),
  };
}

/** Writes: create/delete forums, webhooks, tags. */
function writeSpies(gw: HubForumDiscordGateway, forums: Forums) {
  return {
    createForum: jest.spyOn(gw, 'createForum').mockImplementation((name) => {
      const f = fakeForum({ name });
      forums.set(f.id, f);
      return Promise.resolve(copy(f));
    }),
    ensureWebhook: jest
      .spyOn(gw, 'ensureWebhook')
      .mockImplementation((ch, existing) =>
        Promise.resolve(existing ?? `9${ch.slice(1)}`),
      ),
    addTags: jest.spyOn(gw, 'addTags').mockImplementation((ch, names) => {
      const f = forums.get(ch);
      if (!f) return Promise.reject(new Error(`Forum ${ch} is gone`));
      for (const name of names) f.tags.push({ id: snowflake(), name });
      return Promise.resolve([...f.tags]);
    }),
    requireTags: jest.spyOn(gw, 'requireTags').mockResolvedValue(undefined),
    applyTag: jest.spyOn(gw, 'applyTag').mockResolvedValue(undefined),
    deleteForum: jest.spyOn(gw, 'deleteForum').mockImplementation((ch) => {
      forums.delete(ch);
      return Promise.resolve();
    }),
  };
}

/** The fake Discord's state plus the spies the spec asserts on. */
export type FakeDiscord = ReturnType<typeof stubForumGateway>;

/**
 * Spy on every gateway method. `state.online=false` makes `guildId()` null
 * (bot offline). Forums added with `put` are what `fetchForum`,
 * `cachedForum` and `listForums` see; `createForum` adds a new one.
 */
export function stubForumGateway(testApp: TestApp) {
  const gw = testApp.app.get(HubForumDiscordGateway);
  const forums: Forums = new Map();
  const state: FakeState = { online: true, missingToCreate: [] };
  const spies = { ...readSpies(gw, forums, state), ...writeSpies(gw, forums) };
  /** Add a forum that already exists on Discord (the `existing` picker). */
  const put = (over: Partial<ForumInfo> = {}): ForumInfo => {
    const f = fakeForum(over);
    forums.set(f.id, f);
    return f;
  };
  return { forums, state, spies, put };
}
