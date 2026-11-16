/**
 * ROK-2203 (Codex P2): a PUG accept whose signup is rejected (e.g. a 409
 * while a rescheduling poll is open) must not leave the slot `accepted` —
 * otherwise the invite can never be retried once signups reopen.
 * Covers the Accept button, character-select and role-select paths.
 */
import { ConflictException } from '@nestjs/common';
import type {
  ButtonInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import * as schema from '../../drizzle/schema';
import { PUG_BUTTON_IDS } from '../discord-bot.constants';
import type { PugInviteDeps } from './pug-invite.helpers';
import { handlePugButtonInteraction } from './pug-invite-pug.handlers';
import {
  handlePugCharacterSelectMenu,
  handlePugRoleSelectMenu,
} from './pug-invite-pug-select.handlers';

const POLL_OPEN = 'Signups are paused while a reschedule poll is open';
const DISCORD_ID = 'discord-pug-1';

interface World {
  slot: { id: string; status: string; [key: string]: unknown };
  linked: boolean;
  mmo: boolean;
}

/** Rows a `select().from(table)` returns from the fake world. */
function rowsFor(world: World, table: unknown): unknown[] {
  if (table === schema.pugSlots) return [{ ...world.slot }];
  if (table === schema.users) return world.linked ? [{ id: 7 }] : [];
  if (table === schema.events) {
    const slotConfig = world.mmo ? { type: 'mmo' } : null;
    return [{ id: 1, title: 'Raid Night', gameId: 3, slotConfig }];
  }
  return [];
}

/** A stateful fake db: slot updates persist between interactions. */
function fakeDb(world: World): PugInviteDeps['db'] {
  const select = jest.fn(() => ({
    from: (table: unknown) => ({
      where: () => ({ limit: () => Promise.resolve(rowsFor(world, table)) }),
    }),
  }));
  const update = jest.fn((table: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: () => {
        if (table === schema.pugSlots) Object.assign(world.slot, values);
        return Promise.resolve();
      },
    }),
  }));
  const del = jest.fn(() => ({ where: () => Promise.resolve() }));
  return { select, update, delete: del } as unknown as PugInviteDeps['db'];
}

function buildDeps(world: World): PugInviteDeps {
  const conflict = (): Promise<never> =>
    Promise.reject(new ConflictException(POLL_OPEN));
  const created = { id: 100, assignedSlot: 'dps' };
  return {
    db: fakeDb(world),
    signupsService: {
      signup: jest
        .fn()
        .mockImplementationOnce(conflict)
        .mockResolvedValue(created),
      signupDiscord: jest
        .fn()
        .mockImplementationOnce(conflict)
        .mockResolvedValue(created),
    },
    charactersService: {
      findAllForUser: jest.fn().mockResolvedValue({ data: [] }),
      findOne: jest.fn().mockResolvedValue({ name: 'Thrall', role: 'tank' }),
    },
    pugsService: {},
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
  } as unknown as PugInviteDeps;
}

function newWorld(linked: boolean, mmo: boolean): World {
  const slot = {
    id: 'slot-1',
    eventId: 1,
    discordUserId: DISCORD_ID,
    discordUsername: 'PugPlayer',
    discordAvatarHash: null,
    role: 'dps',
    status: 'invited',
  };
  return { slot, linked, mmo };
}

function interactionBase(customId: string): Record<string, unknown> {
  return {
    customId,
    id: 'interaction-1',
    user: { id: DISCORD_ID },
    replied: false,
    deferred: false,
    deferReply: jest.fn().mockResolvedValue(undefined),
    deferUpdate: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    message: { edit: jest.fn().mockResolvedValue(undefined) },
  };
}

function lastReply(interaction: Record<string, unknown>): unknown {
  const editReply = interaction.editReply as jest.Mock;
  const calls = editReply.mock.calls;
  return (calls[calls.length - 1]?.[0] as { content?: unknown })?.content;
}

async function clickAccept(
  deps: PugInviteDeps,
): Promise<Record<string, unknown>> {
  const i = interactionBase(`${PUG_BUTTON_IDS.ACCEPT}:slot-1`);
  await handlePugButtonInteraction(deps, i as unknown as ButtonInteraction);
  return i;
}

async function pick(
  deps: PugInviteDeps,
  kind: 'character' | 'role',
): Promise<Record<string, unknown>> {
  const i = interactionBase('ignored');
  if (kind === 'character') {
    i.values = ['char-1'];
    await handlePugCharacterSelectMenu(
      deps,
      i as unknown as StringSelectMenuInteraction,
      'slot-1',
    );
  } else {
    i.values = ['tank'];
    await handlePugRoleSelectMenu(
      deps,
      i as unknown as StringSelectMenuInteraction,
      'slot-1',
    );
  }
  return i;
}

describe('PUG accept — a rejected signup leaves the invite retryable (ROK-2203)', () => {
  it.each([
    ['anonymous', false],
    ['linked', true],
  ])('Accept button (%s PUG)', async (_label, linked) => {
    const world = newWorld(linked, false);
    const deps = buildDeps(world);
    const first = await clickAccept(deps);
    expect(lastReply(first)).toBe(POLL_OPEN);
    expect(world.slot.status).toBe('invited');
    const retry = await clickAccept(deps);
    expect(lastReply(retry)).toBe('Accepted!');
    expect(world.slot.status).toBe('accepted');
  });

  it('character select (linked PUG)', async () => {
    const world = newWorld(true, false);
    const deps = buildDeps(world);
    const first = await pick(deps, 'character');
    expect(lastReply(first)).toBe(POLL_OPEN);
    expect(world.slot.status).toBe('invited');
    const retry = await pick(deps, 'character');
    expect(lastReply(retry)).toBe('Accepted as **Thrall**!');
    expect(world.slot.status).toBe('accepted');
  });

  it('role select (anonymous PUG, MMO event)', async () => {
    const world = newWorld(false, true);
    const deps = buildDeps(world);
    const first = await pick(deps, 'role');
    expect(lastReply(first)).toBe(POLL_OPEN);
    expect(world.slot.status).toBe('invited');
    const retry = await pick(deps, 'role');
    expect(lastReply(retry)).toBe('Accepted (Tank)!');
    expect(world.slot.status).toBe('accepted');
    expect(world.slot.role).toBe('tank');
  });
});
