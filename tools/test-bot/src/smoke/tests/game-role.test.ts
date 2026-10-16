/**
 * ROK-1767 — auto-maintained per-game Discord @role, against a real guild.
 *
 *  1. Sweep stale `smoke-gr-*` roles (shared-guild isolation), then link a
 *     game with `roleId: null` so the API bot creates `smoke-gr-<runId>`.
 *  2. Seed a presence session 1 day ago for the companion bot, run the
 *     reconcile for that game, poll until the bot holds the role.
 *  3. Re-seed the last play to 20 days ago (window 14), run, poll until the
 *     role is gone and an `idle since` audit row exists.
 *  4. Hand-assign the role (no grant), run, and confirm it stays — the bot
 *     only removes what it granted.
 *  Only an unlinked game is used (skipped if none), and teardown unlinks
 *  only the link this run created, then deletes this run's role.
 *
 * Membership is read through `GET /admin/test/game-roles/member-roles` — the
 * companion bot has no GuildMembers intent.
 */
import { pollForCondition } from '../../helpers/polling.js';
import type { ApiClient } from '../api.js';
import type { SmokeTest, TestContext } from '../types.js';

const BASE = '/admin/settings/discord-bot/game-roles';
const FIXTURES = '/admin/test/game-roles';
const POLL_MS = 20_000;

interface Summary {
  gameId: number; roleId: string; roleName: string | null; botCreated: boolean; windowDays: number;
}
interface RunResult { added: number; removed: number; failedGames: number[] }
interface Audit { action: string; reason: string; userId: number }

/**
 * A game no channel-pool test is bound to, so no other run plays it, AND not
 * already linked to a role — this run must only ever unlink what it created.
 * `ctx.games` only holds the admin character's game — empty on a seed with
 * no characters (the fleet env), or just the busy `mmoGameId` — so when it has
 * no eligible candidate fall back to the games registry. Null only when the
 * registry has none either (the caller skips, loudly).
 */
async function pickUnlinkedGame(ctx: TestContext): Promise<number | null> {
  const busy = new Set((ctx.channelPool ?? []).map((s) => s.gameId));
  if (ctx.mmoGameId !== undefined) busy.add(ctx.mmoGameId);
  for (const l of await ctx.api.get<Summary[]>(BASE)) busy.add(l.gameId);
  const pick = (games: readonly { id: number }[]): number | null =>
    games.filter((g) => !busy.has(g.id)).at(-1)?.id ?? null;
  const fromCtx = pick(ctx.games);
  if (fromCtx !== null) return fromCtx;
  const registry = await ctx.api.get<{ data?: { id: number; name: string }[] }>(
    '/admin/settings/games?limit=100',
  );
  return pick(registry.data ?? []);
}

async function memberRoles(api: ApiClient, discordUserId: string): Promise<string[]> {
  const res = await api.get<{ roleIds: string[] }>(
    `${FIXTURES}/member-roles?discordUserId=${discordUserId}`,
  );
  return res.roleIds;
}

async function seed(ctx: TestContext, gameId: number, daysAgo: number): Promise<void> {
  const res = await ctx.api.post<{ voicePlays: number }>(`${FIXTURES}/seed-session`, {
    discordUserId: ctx.testBotDiscordId,
    gameId,
    startedAtDaysAgo: daysAgo,
  });
  if (res.voicePlays > 0) {
    throw new Error(
      `game-role smoke: game ${gameId} has ${res.voicePlays} recent event-voice play(s) ` +
        'for the companion bot, which also count as play — pick another game',
    );
  }
}

async function run(ctx: TestContext, gameId: number): Promise<RunResult> {
  const res = await ctx.api.post<RunResult>(`${BASE}/run?gameId=${gameId}`);
  if (res.failedGames.includes(gameId)) {
    throw new Error(`game-role smoke: reconcile failed for game ${gameId}`);
  }
  return res;
}

async function waitForHolding(
  ctx: TestContext,
  roleId: string,
  want: boolean,
): Promise<void> {
  await pollForCondition(async () => {
    const has = (await memberRoles(ctx.api, ctx.testBotDiscordId)).includes(roleId);
    return has === want ? true : null;
  }, POLL_MS);
}

async function addThenIdleRemove(ctx: TestContext, gameId: number, roleId: string): Promise<void> {
  await seed(ctx, gameId, 1);
  const first = await run(ctx, gameId);
  if (first.added < 1) throw new Error(`expected the run to add the role, got ${JSON.stringify(first)}`);
  await waitForHolding(ctx, roleId, true);

  await seed(ctx, gameId, 20);
  const second = await run(ctx, gameId);
  if (second.removed < 1) throw new Error(`expected the run to remove the idle role, got ${JSON.stringify(second)}`);
  await waitForHolding(ctx, roleId, false);
  await pollForCondition(async () => {
    const audit = await ctx.api.get<Audit[]>(`${BASE}/${gameId}/audit?limit=5`);
    return audit.find((a) => a.action === 'role_removed' && a.reason.startsWith('idle since')) ?? null;
  }, POLL_MS);
}

async function handAssignedStays(ctx: TestContext, gameId: number, roleId: string): Promise<void> {
  await ctx.api.post(`${FIXTURES}/hand-assign`, { discordUserId: ctx.testBotDiscordId, roleId });
  await waitForHolding(ctx, roleId, true);
  const res = await run(ctx, gameId);
  const still = (await memberRoles(ctx.api, ctx.testBotDiscordId)).includes(roleId);
  if (res.removed !== 0 || !still) {
    throw new Error(
      `hand-assigned role must survive the reconcile: removed=${res.removed}, stillHeld=${still}`,
    );
  }
}

async function gameRoleAddAndIdleRemove(ctx: TestContext): Promise<void> {
  await ctx.api.post(`${FIXTURES}/sweep`, {});
  const gameId = await pickUnlinkedGame(ctx);
  if (gameId === null) {
    console.warn(
      '  game-role smoke SKIPPED: no eligible game in ctx.games or the games registry ' +
        '(every game is linked, pool-bound or the MMO game) — NO ASSERTIONS RAN',
    );
    return;
  }
  const name = `smoke-gr-${Date.now().toString(36)}`;
  let linked = false;
  try {
    const link = await ctx.api.put<Summary>(`${BASE}/${gameId}`, { roleId: null, windowDays: 14, name });
    // A link made by someone else between pick and PUT keeps ITS role: never
    // claim (and so never tear down) a link this run did not create.
    if (!link.botCreated || (link.roleName !== null && link.roleName !== name)) {
      throw new Error(`game ${gameId} was linked concurrently (role ${link.roleName ?? link.roleId}); not ours`);
    }
    linked = true;
    await addThenIdleRemove(ctx, gameId, link.roleId);
    await handAssignedStays(ctx, gameId, link.roleId);
  } finally {
    if (linked) await ctx.api.delete(`${BASE}/${gameId}`).catch(() => undefined);
    await ctx.api.post(`${FIXTURES}/sweep`, { name }).catch(() => undefined);
  }
}

export const gameRoleTests: SmokeTest[] = [
  {
    name: 'Game role: added on play, removed when idle, hand-assigned kept (ROK-1767)',
    category: 'flow',
    run: gameRoleAddAndIdleRemove,
  },
];
