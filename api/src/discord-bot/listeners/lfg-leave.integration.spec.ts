/**
 * ROK-1660 — the leave surfaces against a real database and the REAL
 * `LfgService`: the board post's `I'm out` (`LfgLeaveListener`) and
 * `/lfg-leave` (`LfgLeaveCommand`, one game and `All my LFGs`).
 *
 * Identity comes from the interaction, so a press or a slash command can only
 * ever clear the caller's own hand — never a neighbour's — and every clear is
 * the HTTP route's `withdraw`, so the group-changed event fires the same way.
 */
import { and, eq } from 'drizzle-orm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as schema from '../../drizzle/schema';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../common/testing/integration-helpers';
import { createMemberAndLogin } from '../../events/signups.integration.spec-helpers';
import {
  banUser,
  createGame,
  deactivateUser,
} from '../../lfg/lfg.integration.spec-helpers';
import { LFG_EVENTS, LFG_LIST_LIMIT } from '../../lfg/lfg.constants';
import { LfgService } from '../../lfg/lfg.service';
import { LfgLeaveCommand } from '../commands/lfg-leave.command';
import {
  LFG_BLOCKED_REPLY,
  LFG_UNLINKED_REPLY,
} from '../commands/lfg.command.helpers';
import { LfgLeaveListener } from './lfg-leave.listener';
import { leaveCustomId } from './lfg-leave.helpers';

let testApp: TestApp;
let listener: LfgLeaveListener;
let command: LfgLeaveCommand;
let lfg: LfgService;
let emitter: EventEmitter2;
const changed: Array<{ gameId: number; reason: string; userIds: number[] }> =
  [];
const record = (p: { gameId: number; reason: string; userIds: number[] }) =>
  changed.push(p);

beforeAll(async () => {
  testApp = await getTestApp();
  await loginAsAdmin(testApp.request, testApp.seed);
  listener = testApp.app.get(LfgLeaveListener);
  command = testApp.app.get(LfgLeaveCommand);
  lfg = testApp.app.get(LfgService);
  emitter = testApp.app.get(EventEmitter2);
  emitter.on(LFG_EVENTS.GROUP_CHANGED, record);
});

afterAll(() => {
  emitter.off(LFG_EVENTS.GROUP_CHANGED, record);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  await loginAsAdmin(testApp.request, testApp.seed);
});

let seq = 0;

/** A member with a real-looking Discord snowflake linked. */
async function linkedMember(): Promise<{ userId: number; discordId: string }> {
  seq += 1;
  const m = await createMemberAndLogin(
    testApp,
    `leaver${seq}`,
    `leaver${seq}@test.local`,
  );
  const discordId = `${200_000_000_000_000_000n + BigInt(m.userId)}`;
  await testApp.db
    .update(schema.users)
    .set({ discordId })
    .where(eq(schema.users.id, m.userId));
  return { userId: m.userId, discordId };
}

/** Raise a hand through the real service, then forget its event. */
async function raise(userId: number, gameId: number): Promise<void> {
  await lfg.createIntent(userId, gameId);
  changed.length = 0;
}

/** `active` while the hand is up, the cleared status after a leave. */
async function statusOf(userId: number, gameId: number): Promise<string[]> {
  const rows = await testApp.db
    .select({ status: schema.lfgIntents.status })
    .from(schema.lfgIntents)
    .where(
      and(
        eq(schema.lfgIntents.userId, userId),
        eq(schema.lfgIntents.gameId, gameId),
      ),
    );
  return rows.map((r) => r.status);
}

const isActive = async (userId: number, gameId: number) =>
  (await statusOf(userId, gameId)).includes('active');

/**
 * LFG_LIST_LIMIT one-hand groups held by `holderId` that all expire within the
 * hour, so any later one-hand group sorts LAST in `GET /lfg` and falls off
 * the capped list.
 */
async function crowdPastListCap(holderId: number): Promise<void> {
  const filler = await testApp.db
    .insert(schema.games)
    .values(
      Array.from({ length: LFG_LIST_LIMIT }, (_, i) => ({
        name: `Filler ${i}`,
        slug: `filler-${i}`,
      })),
    )
    .returning({ id: schema.games.id });
  const soon = new Date(Date.now() + 60 * 60 * 1000);
  await testApp.db.insert(schema.lfgIntents).values(
    filler.map((g) => ({ userId: holderId, gameId: g.id, expiresAt: soon })),
  );
}

function pressLeave(gameId: number, discordId: string) {
  const editReply = jest.fn().mockResolvedValue(undefined);
  const interaction = {
    customId: leaveCustomId(gameId),
    user: { id: discordId },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply,
  } as never;
  return { interaction, editReply };
}

function slash(game: string | null, discordId: string) {
  const editReply = jest.fn().mockResolvedValue(undefined);
  const interaction = {
    user: { id: discordId },
    options: { getString: () => game },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply,
  } as never;
  return { interaction, editReply };
}

describe("LfgLeaveListener — the board's I'm out (ROK-1660)", () => {
  it('clears only the presser’s hand and emits group-changed for them', async () => {
    const a = await linkedMember();
    const b = await linkedMember();
    const game = await createGame(testApp, 'Valheim');
    await raise(a.userId, game.id);
    await raise(b.userId, game.id);

    const { interaction, editReply } = pressLeave(game.id, a.discordId);
    await listener.handleButtonInteraction(interaction);

    expect(
      `a=${String(await isActive(a.userId, game.id))} b=${String(await isActive(b.userId, game.id))}`,
    ).toBe('a=false b=true');
    expect(changed).toEqual([
      { gameId: game.id, reason: 'withdrawn', userIds: [a.userId] },
    ]);
    expect(editReply).toHaveBeenCalledWith({
      content: "You're out — **Valheim**. 1 still looking.",
    });
  });

  it('no hand up → the not-in reply, nothing changes, no event', async () => {
    const a = await linkedMember();
    const b = await linkedMember();
    const game = await createGame(testApp, 'Deep Rock Galactic');
    await raise(b.userId, game.id);

    const { interaction, editReply } = pressLeave(game.id, a.discordId);
    await listener.handleButtonInteraction(interaction);

    expect(await isActive(b.userId, game.id)).toBe(true);
    expect(changed).toEqual([]);
    expect(editReply).toHaveBeenCalledWith({
      content: "You're not in the **Deep Rock Galactic** group.",
    });
  });

  it.each([
    ['deactivated', deactivateUser],
    ['banned', banUser],
  ])('a %s presser changes nothing', async (_label, block) => {
    const a = await linkedMember();
    const game = await createGame(testApp, 'Helldivers 2');
    await raise(a.userId, game.id);
    await block(testApp, a.userId);

    const { interaction, editReply } = pressLeave(game.id, a.discordId);
    await listener.handleButtonInteraction(interaction);

    expect(await statusOf(a.userId, game.id)).toEqual(['active']);
    expect(changed).toEqual([]);
    expect(editReply).toHaveBeenCalledWith({ content: LFG_BLOCKED_REPLY });
  });

  it('an unlinked presser changes nothing', async () => {
    const a = await linkedMember();
    const game = await createGame(testApp, 'Lethal Company');
    await raise(a.userId, game.id);

    const { interaction, editReply } = pressLeave(
      game.id,
      '999999999999999999',
    );
    await listener.handleButtonInteraction(interaction);

    expect(await isActive(a.userId, game.id)).toBe(true);
    expect(changed).toEqual([]);
    expect(editReply).toHaveBeenCalledWith({ content: LFG_UNLINKED_REPLY });
  });
});

describe('LfgLeaveCommand — /lfg-leave (ROK-1660)', () => {
  it('one game: clears only the caller’s hand for it', async () => {
    const a = await linkedMember();
    const b = await linkedMember();
    const valheim = await createGame(testApp, 'Valheim');
    const drg = await createGame(testApp, 'Deep Rock Galactic');
    await raise(a.userId, valheim.id);
    await raise(a.userId, drg.id);
    await raise(b.userId, valheim.id);

    const { interaction, editReply } = slash(String(valheim.id), a.discordId);
    await command.handleInteraction(interaction);

    expect(await isActive(a.userId, valheim.id)).toBe(false);
    expect(await isActive(a.userId, drg.id)).toBe(true);
    expect(await isActive(b.userId, valheim.id)).toBe(true);
    expect(changed).toEqual([
      { gameId: valheim.id, reason: 'withdrawn', userIds: [a.userId] },
    ]);
    expect(editReply).toHaveBeenCalledWith(
      "You're out — **Valheim**. 1 still looking.",
    );
  });

  it('a game the caller has no hand in → not-in reply, nothing changes', async () => {
    const a = await linkedMember();
    const b = await linkedMember();
    const game = await createGame(testApp, 'Satisfactory');
    await raise(b.userId, game.id);

    const { interaction, editReply } = slash('Satisfactory', a.discordId);
    await command.handleInteraction(interaction);

    expect(await isActive(b.userId, game.id)).toBe(true);
    expect(changed).toEqual([]);
    expect(editReply).toHaveBeenCalledWith(
      "You're not in the **Satisfactory** group.",
    );
  });
});

describe('LfgLeaveCommand — All my LFGs (ROK-1660)', () => {
  it('All my LFGs clears every own hand and nobody else’s', async () => {
    const a = await linkedMember();
    const b = await linkedMember();
    const g1 = await createGame(testApp, 'Valheim');
    const g2 = await createGame(testApp, 'Deep Rock Galactic');
    const g3 = await createGame(testApp, 'Helldivers 2');
    await raise(a.userId, g1.id);
    await raise(a.userId, g2.id);
    await raise(b.userId, g1.id);
    await raise(b.userId, g3.id);

    const { interaction, editReply } = slash('all', a.discordId);
    await command.handleInteraction(interaction);

    expect(await isActive(a.userId, g1.id)).toBe(false);
    expect(await isActive(a.userId, g2.id)).toBe(false);
    expect(await isActive(b.userId, g1.id)).toBe(true);
    expect(await isActive(b.userId, g3.id)).toBe(true);
    expect(changed.map((c) => c.gameId).sort()).toEqual([g1.id, g2.id].sort());
    expect(changed.every((c) => c.userIds.join() === String(a.userId))).toBe(
      true,
    );
    expect(String(editReply.mock.calls[0]?.[0])).toMatch(
      /^You're out of all 2 — /,
    );
  });

  it(`All my LFGs reaches a hand ranked past the ${LFG_LIST_LIMIT}-group list cap`, async () => {
    const a = await linkedMember();
    const b = await linkedMember();
    await crowdPastListCap(b.userId);
    const quiet = await createGame(testApp, 'Quiet Game');
    await raise(a.userId, quiet.id);
    const capped = await lfg.listGroups(a.userId);
    expect(capped.some((g) => g.gameId === quiet.id)).toBe(false);

    const { interaction, editReply } = slash('all', a.discordId);
    await command.handleInteraction(interaction);

    expect(await isActive(a.userId, quiet.id)).toBe(false);
    expect(editReply).toHaveBeenCalledWith("You're out — **Quiet Game**.");
  });

  it.each(['hidden', 'banned'] as const)(
    'All my LFGs also withdraws a hand on a %s game',
    async (flag) => {
      const a = await linkedMember();
      const shown = await createGame(testApp, 'Valheim');
      const gone = await createGame(testApp, 'Gone Game');
      await raise(a.userId, shown.id);
      await raise(a.userId, gone.id);
      await testApp.db
        .update(schema.games)
        .set(flag === 'hidden' ? { hidden: true } : { banned: true })
        .where(eq(schema.games.id, gone.id));
      // The display list hides the game — the bulk leave must not.
      const listed = await lfg.listOwnGroups(a.userId);
      expect(listed.map((g) => g.gameId)).toEqual([shown.id]);

      const { interaction, editReply } = slash('all', a.discordId);
      await command.handleInteraction(interaction);

      expect(
        `shown=${String(await isActive(a.userId, shown.id))} gone=${String(await isActive(a.userId, gone.id))}`,
      ).toBe('shown=false gone=false');
      expect(String(editReply.mock.calls[0]?.[0])).toMatch(
        /^You're out of all 2 — /,
      );
    },
  );
});

type LeaveSurface = (gameId: number, discordId: string) => Promise<unknown>;

/** Each leave surface, returning the first reply it sent. */
const surfaces: Array<[string, LeaveSurface]> = [
  [
    "the board's I'm out",
    async (gameId, discordId) => {
      const { interaction, editReply } = pressLeave(gameId, discordId);
      await listener.handleButtonInteraction(interaction);
      return editReply.mock.calls[0]?.[0];
    },
  ],
  [
    '/lfg-leave <game>',
    async (gameId, discordId) => {
      const { interaction, editReply } = slash(String(gameId), discordId);
      await command.handleInteraction(interaction);
      return editReply.mock.calls[0]?.[0];
    },
  ],
  [
    '/lfg-leave All my LFGs (one hand)',
    async (_gameId, discordId) => {
      const { interaction, editReply } = slash('all', discordId);
      await command.handleInteraction(interaction);
      return editReply.mock.calls[0]?.[0];
    },
  ],
];

describe('the still-looking count is game-scoped (ROK-1660)', () => {
  it.each(surfaces)(
    `%s counts a group ranked past the ${LFG_LIST_LIMIT}-group list cap`,
    async (_label, leave) => {
      const a = await linkedMember();
      const b = await linkedMember();
      const c = await linkedMember();
      await crowdPastListCap(b.userId);
      const quiet = await createGame(testApp, 'Quiet Game');
      await raise(a.userId, quiet.id);
      await raise(c.userId, quiet.id);

      const reply = await leave(quiet.id, a.discordId);

      // Precondition: the global list no longer carries the group at all, so
      // a count read from it would say nobody is left.
      const capped = await lfg.listGroups(a.userId);
      expect(capped.some((g) => g.gameId === quiet.id)).toBe(false);
      expect(JSON.stringify(reply)).toContain(
        "You're out — **Quiet Game**. 1 still looking.",
      );
    },
  );
});

describe('LfgLeaveCommand — guards (ROK-1660)', () => {
  it.each([
    ['deactivated', deactivateUser, LFG_BLOCKED_REPLY],
    ['banned', banUser, LFG_BLOCKED_REPLY],
  ])('a %s caller’s All my LFGs changes nothing', async (_l, block, reply) => {
    const a = await linkedMember();
    const game = await createGame(testApp, 'Valheim');
    await raise(a.userId, game.id);
    await block(testApp, a.userId);

    const { interaction, editReply } = slash('all', a.discordId);
    await command.handleInteraction(interaction);

    expect(await statusOf(a.userId, game.id)).toEqual(['active']);
    expect(changed).toEqual([]);
    expect(editReply).toHaveBeenCalledWith(reply);
  });

  it('an unlinked caller’s All my LFGs changes nothing', async () => {
    const a = await linkedMember();
    const game = await createGame(testApp, 'Valheim');
    await raise(a.userId, game.id);

    const { interaction, editReply } = slash('all', '999999999999999998');
    await command.handleInteraction(interaction);

    expect(await isActive(a.userId, game.id)).toBe(true);
    expect(changed).toEqual([]);
    expect(editReply).toHaveBeenCalledWith(LFG_UNLINKED_REPLY);
  });
});
