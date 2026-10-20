/**
 * ROK-1856 — the armory's L-5 hidden-hub check: non-staff get the core hub
 * routes' 404 body while the character's / server's hub is hidden; staff and
 * hub-less characters pass without the predicate changing.
 */
import { NotFoundException } from '@nestjs/common';
import type { GuildActor } from '../../../../guilds/guild-access.service';
import { HUB_NOT_FOUND } from '../../../../guilds/hub-hidden.helpers';
import {
  assertCharacterHubVisible,
  assertServerHubVisible,
  hubHiddenFrom,
  type ArmoryHub,
} from './valheim-armory-hub-visibility.helpers';

const MEMBER: GuildActor = { id: 2, role: 'member' };
const ADMIN: GuildActor = { id: 1, role: 'admin' };
const OPERATOR: GuildActor = { id: 3, role: 'operator' };
const HIDDEN: ArmoryHub = { id: 9, hidden: true };
const SHOWN: ArmoryHub = { id: 9, hidden: false };

function lookup(hub: ArmoryHub) {
  return {
    findServerHub: jest.fn(() => Promise.resolve(hub)),
    findProfileHub: jest.fn(() => Promise.resolve(hub)),
  };
}

describe('hubHiddenFrom', () => {
  it.each([
    [HIDDEN, MEMBER, true],
    [HIDDEN, ADMIN, false],
    [HIDDEN, OPERATOR, false],
    [SHOWN, MEMBER, false],
    [null, MEMBER, false],
  ])('hub %j, actor %j → %s', (hub, actor, expected) => {
    expect(hubHiddenFrom(hub, actor)).toBe(expected);
  });
});

describe.each([
  ['assertCharacterHubVisible', assertCharacterHubVisible, 'findProfileHub'],
  ['assertServerHubVisible', assertServerHubVisible, 'findServerHub'],
] as const)('%s', (_name, assertVisible, method) => {
  it('404s a member with the core hub routes’ body while hidden', async () => {
    const repo = lookup(HIDDEN);
    const err = await assertVisible(repo, MEMBER, 5).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect((err as NotFoundException).message).toBe(HUB_NOT_FOUND);
    expect(repo[method]).toHaveBeenCalledWith(5);
  });

  it('lets staff through without a lookup', async () => {
    const repo = lookup(HIDDEN);
    await expect(assertVisible(repo, ADMIN, 5)).resolves.toBeUndefined();
    expect(repo[method]).not.toHaveBeenCalled();
  });

  it.each([SHOWN, null])('passes a member when the hub is %j', async (hub) => {
    await expect(
      assertVisible(lookup(hub), MEMBER, 5),
    ).resolves.toBeUndefined();
  });
});
