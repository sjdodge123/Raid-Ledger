/**
 * ROK-1767 — GameRoleReconcileService against a real DB with the Discord
 * helpers mocked: adds/removes applied and audited, grants only for bot adds,
 * the mutation cap, per-game failure isolation (Sentry), and grantNow's
 * opt-out gate + existing-grant restore, and the idle-since date counting
 * event attendance.
 *
 * Mocks are `jest.spyOn` on the live module objects, NOT `jest.mock`: the
 * integration `setupFilesAfterEnv` imports AppModule → this service → the
 * real helpers before a spec's hoisted `jest.mock` registers, so a module
 * mock never reaches the service (same trap as ROK-1307's steam-auth spec).
 */
import type * as SentryModule from '@sentry/nestjs';
import { Collection, type GuildMember } from 'discord.js';
import { eq } from 'drizzle-orm';
import { GAME_ROLES_OPT_OUT_PREF_KEY } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import type { CronJobService } from '../../cron-jobs/cron-job.service';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import * as discord from './game-role-discord.helpers';
import { GameRoleReconcileService } from './game-role-reconcile.service';
import { saveGameRole } from './game-roles-settings.helpers';

/** The raw CJS module the service's `import * as Sentry` reads through. */
const sentry = jest.requireActual<typeof SentryModule>('@sentry/nestjs');

const GUILD = { id: 'guild-1' };
const MEMBERS = new Collection<string, GuildMember>();
let testApp: TestApp;
let service: GameRoleReconcileService;
let seq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
});

const mocked = {
  fetchGuildMembers: jest.spyOn(discord, 'fetchGuildMembers'),
  fetchRoleState: jest.spyOn(discord, 'fetchRoleState'),
  memberHoldsRole: jest.spyOn(discord, 'memberHoldsRole'),
  cachedMemberLacksRole: jest.spyOn(discord, 'cachedMemberLacksRole'),
  addMemberRole: jest.spyOn(discord, 'addMemberRole'),
  removeMemberRole: jest.spyOn(discord, 'removeMemberRole'),
};
const captureException = jest.spyOn(sentry, 'captureException');

beforeEach(() => {
  jest.clearAllMocks();
  // Every Discord boundary is stubbed so no case can fall through to a real
  // `guild.members.fetch` on the fake guild.
  mocked.fetchGuildMembers.mockResolvedValue(MEMBERS);
  mocked.fetchRoleState.mockRejectedValue(new Error('fetchRoleState unset'));
  mocked.memberHoldsRole.mockRejectedValue(new Error('memberHoldsRole unset'));
  mocked.cachedMemberLacksRole.mockReturnValue(false);
  mocked.addMemberRole.mockResolvedValue(true);
  mocked.removeMemberRole.mockResolvedValue(true);
  captureException.mockReturnValue('event-id');
  const bot = { getGuild: () => GUILD } as unknown as DiscordBotClientService;
  const cron = {} as CronJobService;
  service = new GameRoleReconcileService(testApp.db, cron, bot);
});

afterAll(() => {
  jest.restoreAllMocks();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

async function makeUser(): Promise<{ id: number; discordId: string }> {
  seq += 1;
  const discordId = `91000000000000${seq}`;
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId, username: `grr-${seq}`, role: 'member' })
      .returning(),
    'user',
  );
  return { id: u.id, discordId };
}

async function makeGame(name: string): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name, slug: `grr-${name}-${seq}`, igdbId: null })
      .returning(),
    'game',
  );
  return g.id;
}

async function link(gameId: number, roleId: string): Promise<number> {
  const [r] = nonEmpty(
    await testApp.db
      .insert(schema.discordGameRoles)
      .values({ gameId, roleId, windowDays: 14 })
      .returning(),
    'link',
  );
  return r.id;
}

async function played(userId: number, gameId: number, days: number) {
  await testApp.db.insert(schema.gameActivitySessions).values({
    userId,
    gameId,
    discordActivityName: 'Game',
    startedAt: new Date(Date.now() - days * 86_400_000),
  });
}

/** Voice attendance at a scheduled event for `gameId`, left `days` ago. */
async function attendedEvent(
  u: { id: number; discordId: string },
  gameId: number,
  days: number,
) {
  const end = new Date(Date.now() - days * 86_400_000);
  const [ev] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: `GRR Raid ${++seq}`,
        creatorId: testApp.seed.adminUser.id,
        gameId,
        duration: [new Date(end.getTime() - 3_600_000), end],
      })
      .returning(),
    'event',
  );
  await testApp.db.insert(schema.eventVoiceSessions).values({
    eventId: ev.id,
    userId: u.id,
    discordUserId: u.discordId,
    discordUsername: 'voice-user',
    firstJoinAt: new Date(end.getTime() - 3_600_000),
    lastLeaveAt: end,
    totalDurationSec: 3600,
    classification: 'full',
  });
}

async function grant(gameRoleId: number, u: { id: number; discordId: string }) {
  await testApp.db
    .insert(schema.discordGameRoleGrants)
    .values({ gameRoleId, userId: u.id, discordUserId: u.discordId });
}

const grantsOf = async (gameRoleId: number) =>
  (
    await testApp.db
      .select()
      .from(schema.discordGameRoleGrants)
      .where(eq(schema.discordGameRoleGrants.gameRoleId, gameRoleId))
  ).map((g) => g.userId);

const auditOf = async (gameRoleId: number) =>
  (
    await testApp.db
      .select()
      .from(schema.activityLog)
      .where(eq(schema.activityLog.entityId, gameRoleId))
  ).map((a) => ({
    action: a.action,
    reason: (a.metadata as { reason: string }).reason,
  }));

function liveState(holders: string[], members: string[]): void {
  mocked.fetchRoleState.mockResolvedValue({
    holders: new Set(holders),
    memberIds: new Set(members),
  });
}

describe('GameRoleReconcileService (ROK-1767)', () => {
  it('adds players, removes idle bot grants, never touches hand-assigned holders', async () => {
    const gameId = await makeGame('Valheim');
    const roleRowId = await link(gameId, 'role-1');
    const [player, idler, handHolder] = [
      await makeUser(),
      await makeUser(),
      await makeUser(),
    ];
    await played(player.id, gameId, 1);
    await played(idler.id, gameId, 30);
    await grant(roleRowId, idler);
    liveState(
      [idler.discordId, handHolder.discordId],
      [player.discordId, idler.discordId, handHolder.discordId],
    );

    const result = await service.runReconciliation();

    expect(result).toEqual({
      added: 1,
      removed: 1,
      skippedOverCap: 0,
      failedGames: [],
    });
    expect(mocked.addMemberRole).toHaveBeenCalledWith(
      GUILD,
      player.discordId,
      'role-1',
      expect.stringMatching(/^played /),
    );
    expect(mocked.removeMemberRole).toHaveBeenCalledWith(
      GUILD,
      idler.discordId,
      'role-1',
      expect.stringMatching(/^idle since /),
    );
    expect(mocked.removeMemberRole).not.toHaveBeenCalledWith(
      GUILD,
      handHolder.discordId,
      expect.anything(),
      expect.anything(),
    );
    expect(await grantsOf(roleRowId)).toEqual([player.id]);
    const audit = await auditOf(roleRowId);
    expect(audit.map((a) => a.action).sort()).toEqual([
      'role_added',
      'role_removed',
    ]);
    expect(audit.find((a) => a.action === 'role_removed')?.reason).toMatch(
      /^idle since /,
    );
  });

  it('stops at the mutation cap and reports the remainder', async () => {
    const gameId = await makeGame('Cap Game');
    const roleRowId = await link(gameId, 'role-cap');
    const users = [await makeUser(), await makeUser(), await makeUser()];
    for (const u of users) await played(u.id, gameId, 1);
    liveState(
      [],
      users.map((u) => u.discordId),
    );
    service.mutationCap = 2;

    const result = await service.runReconciliation();

    expect(result).toEqual({
      added: 2,
      removed: 0,
      skippedOverCap: 1,
      failedGames: [],
    });
    expect(mocked.addMemberRole).toHaveBeenCalledTimes(2);
    expect(await grantsOf(roleRowId)).toHaveLength(2);
  });

  it('spends the cap on removals before adds', async () => {
    const gameId = await makeGame('Cap Order');
    const roleRowId = await link(gameId, 'role-order');
    const [player, idler] = [await makeUser(), await makeUser()];
    await played(player.id, gameId, 1);
    await grant(roleRowId, idler);
    liveState([idler.discordId], [player.discordId, idler.discordId]);
    service.mutationCap = 1;

    const result = await service.runReconciliation();

    expect(result).toEqual({
      added: 0,
      removed: 1,
      skippedOverCap: 1,
      failedGames: [],
    });
    expect(mocked.addMemberRole).not.toHaveBeenCalled();
  });

  it('isolates a failing game: reports it to Sentry and still runs the next', async () => {
    const broken = await makeGame('Broken');
    const fine = await makeGame('Fine');
    await link(broken, 'role-broken');
    const fineRowId = await link(fine, 'role-fine');
    const u = await makeUser();
    await played(u.id, fine, 1);
    mocked.fetchRoleState.mockImplementation((_g, roleId) =>
      roleId === 'role-broken'
        ? Promise.reject(new Error('discord down'))
        : Promise.resolve({
            holders: new Set<string>(),
            memberIds: new Set([u.discordId]),
          }),
    );

    const result = await service.runReconciliation();

    expect(result).toEqual({
      added: 1,
      removed: 0,
      skippedOverCap: 0,
      failedGames: [broken],
    });
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { gameId: String(broken) },
    });
    // One member fetch per run, shared by both games.
    expect(mocked.fetchGuildMembers).toHaveBeenCalledTimes(1);
    expect(mocked.fetchRoleState).toHaveBeenCalledWith(
      GUILD,
      'role-fine',
      MEMBERS,
    );
    expect(await grantsOf(fineRowId)).toEqual([u.id]);
  });

  it('reports every game failed when the member list stays rate limited', async () => {
    const gameId = await makeGame('Throttled');
    await link(gameId, 'role-throttled');
    // fetchGuildMembers already waited and retried once; this is the 2nd 429.
    const limited = Object.assign(new Error('opcode 8 was rate limited'), {
      name: 'GatewayRateLimitError',
    });
    mocked.fetchGuildMembers.mockRejectedValue(limited);

    const result = await service.runReconciliation();

    expect(result).toEqual({
      added: 0,
      removed: 0,
      skippedOverCap: 0,
      failedGames: [gameId],
    });
    expect(captureException).toHaveBeenCalledWith(limited, {
      tags: { gameId: String(gameId) },
    });
    expect(mocked.fetchRoleState).not.toHaveBeenCalled();
    expect(mocked.addMemberRole).not.toHaveBeenCalled();
  });

  it('grantNow adds a new player but skips one who opted out', async () => {
    const gameId = await makeGame('Live');
    const roleRowId = await link(gameId, 'role-live');
    const [keen, optedOut] = [await makeUser(), await makeUser()];
    await testApp.db.insert(schema.userPreferences).values({
      userId: optedOut.id,
      key: GAME_ROLES_OPT_OUT_PREF_KEY,
      value: true,
    });
    mocked.memberHoldsRole.mockResolvedValue(false);

    expect(await service.grantNow(optedOut.id, gameId)).toBe(false);
    expect(await service.grantNow(keen.id, gameId)).toBe(true);

    expect(mocked.addMemberRole).toHaveBeenCalledTimes(1);
    expect(mocked.addMemberRole).toHaveBeenCalledWith(
      GUILD,
      keen.discordId,
      'role-live',
      expect.stringMatching(/^played /),
    );
    expect(await grantsOf(roleRowId)).toEqual([keen.id]);
  });

  it('idle-since dates the last play across presence AND event attendance', async () => {
    const gameId = await makeGame('Raids');
    const roleRowId = await link(gameId, 'role-att');
    const raider = await makeUser();
    await played(raider.id, gameId, 40);
    await attendedEvent(raider, gameId, 20);
    await grant(roleRowId, raider);
    liveState([raider.discordId], [raider.discordId]);

    await service.runReconciliation();

    const attendedOn = new Date(Date.now() - 20 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(await auditOf(roleRowId)).toEqual([
      { action: 'role_removed', reason: `idle since ${attendedOn}` },
    ]);
  });

  it('grantNow restores a granted role the member no longer holds', async () => {
    const gameId = await makeGame('Restore');
    const roleRowId = await link(gameId, 'role-back');
    const u = await makeUser();
    await grant(roleRowId, u);
    mocked.cachedMemberLacksRole.mockReturnValue(true);
    mocked.memberHoldsRole.mockResolvedValue(false);

    expect(await service.grantNow(u.id, gameId)).toBe(true);

    expect(mocked.addMemberRole).toHaveBeenCalledWith(
      GUILD,
      u.discordId,
      'role-back',
      expect.stringMatching(/^played /),
    );
    expect(await grantsOf(roleRowId)).toEqual([u.id]);
    expect((await auditOf(roleRowId)).map((a) => a.action)).toEqual([
      'role_added',
    ]);
  });
});

describe('ROK-1767 Codex P2 — relink and concurrent link races', () => {
  it('grantNow after a Discord relink removes the role from the OLD account, then grants the new one', async () => {
    const gameId = await makeGame('Relink');
    const roleRowId = await link(gameId, 'role-relink');
    const user = await makeUser();
    await grant(roleRowId, { id: user.id, discordId: 'old-account-1' });
    mocked.memberHoldsRole.mockResolvedValue(false);

    expect(await service.grantNow(user.id, gameId)).toBe(true);

    expect(mocked.removeMemberRole.mock.calls.map((c) => c[1])).toEqual([
      'old-account-1',
    ]);
    expect(mocked.addMemberRole.mock.calls.map((c) => c[1])).toEqual([
      user.discordId,
    ]);
    const rows = await testApp.db
      .select()
      .from(schema.discordGameRoleGrants)
      .where(eq(schema.discordGameRoleGrants.gameRoleId, roleRowId));
    expect(rows.map((r) => r.discordUserId)).toEqual([user.discordId]);
    expect(await auditOf(roleRowId)).toEqual(
      expect.arrayContaining([
        { action: 'role_removed', reason: 'discord account relinked' },
      ]),
    );
  });

  it('a second save for an already-linked game keeps the stored role and returns it', async () => {
    const gameId = await makeGame('Race');
    await link(gameId, 'first-role');

    const saved = await saveGameRole(testApp.db, {
      gameId,
      roleId: 'second-role',
      botCreated: true,
      windowDays: 7,
      enabled: true,
    });

    expect(saved).toEqual({ roleId: 'first-role' });
    const [row] = await testApp.db
      .select()
      .from(schema.discordGameRoles)
      .where(eq(schema.discordGameRoles.gameId, gameId));
    expect({ roleId: row?.roleId, windowDays: row?.windowDays }).toEqual({
      roleId: 'first-role',
      windowDays: 7,
    });
  });
});
