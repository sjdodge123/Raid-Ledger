/**
 * ROK-2272 S0b §3.4 — the one-time `#hub-forums` → `#event-planning` rename:
 * the exact condition table, and a 50013 refusal that never throws.
 */
import * as Sentry from '@sentry/nestjs';
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

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

describe('shouldRenameForum (§3.4 exact condition)', () => {
  it.each([
    [
      'managed #hub-forums, name free ⇒ rename',
      true,
      'hub-forums',
      false,
      true,
    ],
    ['unmanaged #hub-forums ⇒ never', false, 'hub-forums', false, false],
    ['managed forum with another name ⇒ never', true, 'raiders', false, false],
    [
      'managed already #event-planning ⇒ no-op',
      true,
      'event-planning',
      true,
      false,
    ],
    ['#event-planning already exists ⇒ no', true, 'hub-forums', true, false],
  ])('%s', (_label, managed, liveName, targetTaken, expected) => {
    expect(shouldRenameForum({ managed, liveName, targetTaken })).toBe(
      expected,
    );
  });
});

function forum(name: string): ForumInfo {
  return {
    id: 'c1',
    name,
    tags: [],
    missing: [],
    canManage: true,
    isPublic: true,
    requireTag: false,
  };
}

function setup(
  liveName: string,
  taken: boolean | (() => boolean),
  rename: jest.Mock,
  ids: string[] = ['c1'],
) {
  const gateway = {
    guildId: () => 'g1',
    fetchForum: jest.fn((id: string) =>
      Promise.resolve({ ...forum(liveName), id }),
    ),
    channelNameTaken: jest.fn(
      typeof taken === 'function' ? taken : () => taken,
    ),
    renameForum: rename,
  };
  const binds = { run: <T>(_k: string, task: () => Promise<T>) => task() };
  const svc = new EventPlanningForumRename(
    {} as ForumDiscordDb,
    gateway as unknown as HubForumDiscordGateway,
    binds as unknown as HubForumBindLock,
  );
  jest.spyOn(svc, 'managedForumIds').mockResolvedValue(new Set(ids));
  return svc;
}

function discordError(code: number, status: number): DiscordAPIError {
  return new DiscordAPIError(
    { code, message: 'refused' },
    code,
    status,
    'PATCH',
    '/channels/c1',
    { body: undefined, files: undefined },
  );
}

describe('EventPlanningForumRename.run', () => {
  beforeEach(() => jest.clearAllMocks());

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
    const rename = jest.fn(() => Promise.reject(discordError(50013, 403)));
    await expect(setup('hub-forums', false, rename).run()).resolves.toBe(0);
    expect(rename).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('50013'),
      expect.objectContaining({ level: 'warning' }),
    );
  });

  it('any other Discord error is reported, never thrown, and the next READY retries', async () => {
    const failure = discordError(50035, 400);
    const rename = jest
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(forum('event-planning'));
    const svc = setup('hub-forums', false, rename);
    await expect(svc.run()).resolves.toBe(0);
    expect(Sentry.captureException).toHaveBeenCalledWith(failure);
    await expect(svc.run()).resolves.toBe(1);
    expect(rename).toHaveBeenCalledTimes(2);
  });

  it('two managed #hub-forums in one guild ⇒ exactly one rename', async () => {
    let taken = false;
    const rename = jest.fn((id: string) => {
      taken = true;
      return Promise.resolve({ ...forum('event-planning'), id });
    });
    const svc = setup('hub-forums', () => taken, rename, ['c1', 'c2']);
    await expect(svc.run()).resolves.toBe(1);
    expect(rename).toHaveBeenCalledTimes(1);
    expect(rename).toHaveBeenCalledWith('c1', 'event-planning');
  });
});
