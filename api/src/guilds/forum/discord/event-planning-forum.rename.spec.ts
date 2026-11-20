/**
 * ROK-2272 S0b §3.4 — the one-time `#hub-forums` → `#event-planning` rename:
 * the exact condition table, and a 50013 refusal that never throws.
 */
import { DiscordAPIError } from 'discord.js';
import {
  EventPlanningForumRename,
  shouldRenameForum,
} from './event-planning-forum.rename';
import type { HubForumBindLock } from './hub-forum-discord.bind-lock';
import type {
  ForumInfo,
  HubForumDiscordGateway,
} from './hub-forum-discord.gateway';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

describe('shouldRenameForum (§3.4 exact condition)', () => {
  it.each([
    ['managed #hub-forums, name free ⇒ rename', true, 'hub-forums', false, true],
    ['unmanaged #hub-forums ⇒ never', false, 'hub-forums', false, false],
    ['managed forum with another name ⇒ never', true, 'raiders', false, false],
    ['managed already #event-planning ⇒ no-op', true, 'event-planning', true, false],
    ['#event-planning already exists ⇒ no', true, 'hub-forums', true, false],
  ])('%s', (_label, managed, liveName, targetTaken, expected) => {
    expect(shouldRenameForum({ managed, liveName, targetTaken })).toBe(expected);
  });
});

function forum(name: string): ForumInfo {
  return { id: 'c1', name, tags: [], missing: [], canManage: true, isPublic: true, requireTag: false };
}

function setup(liveName: string, taken: boolean, rename: jest.Mock) {
  const gateway = {
    guildId: () => 'g1',
    fetchForum: jest.fn(() => Promise.resolve(forum(liveName))),
    channelNameTaken: jest.fn(() => taken),
    renameForum: rename,
  };
  const binds = { run: <T>(_k: string, task: () => Promise<T>) => task() };
  const svc = new EventPlanningForumRename(
    {} as ForumDiscordDb,
    gateway as unknown as HubForumDiscordGateway,
    binds as unknown as HubForumBindLock,
  );
  jest.spyOn(svc, 'managedForumIds').mockResolvedValue(new Set(['c1']));
  return svc;
}

describe('EventPlanningForumRename.run', () => {
  it('renames the managed #hub-forums to #event-planning', async () => {
    const rename = jest.fn(() => Promise.resolve(forum('event-planning')));
    await expect(setup('hub-forums', false, rename).run()).resolves.toBe(1);
    expect(rename).toHaveBeenCalledWith('c1', 'event-planning');
  });

  it('leaves the forum alone when #event-planning already exists', async () => {
    const rename = jest.fn();
    await expect(setup('hub-forums', true, rename).run()).resolves.toBe(0);
    expect(rename).not.toHaveBeenCalled();
  });

  it('a 50013 (Missing Permissions) refusal does not throw', async () => {
    const refused = new DiscordAPIError(
      { code: 50013, message: 'Missing Permissions' },
      50013, 403, 'PATCH', '/channels/c1', { body: undefined, files: undefined },
    );
    const rename = jest.fn(() => Promise.reject(refused));
    await expect(setup('hub-forums', false, rename).run()).resolves.toBe(0);
    expect(rename).toHaveBeenCalledTimes(1);
  });
});
