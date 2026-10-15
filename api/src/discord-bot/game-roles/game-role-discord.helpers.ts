/**
 * ROK-1767: every Discord call the game-role feature makes. Kept out of
 * `discord-bot-client.service.ts` (size cap); each function takes the guild
 * the caller already resolved, `null` meaning the bot is disconnected.
 */
import {
  Collection,
  PermissionFlagsBits,
  RateLimitError,
  type Guild,
  type GuildMember,
  type Role,
} from 'discord.js';
import type { GameRolePreflightDto } from '@raid-ledger/contract';

type Problem = GameRolePreflightDto['problems'][number];

/** Discord "Unknown Member" — the user is not (or no longer) in the guild. */
const UNKNOWN_MEMBER = 10007;

/** Live role state for one game role, from a single member fetch. */
export interface RoleState {
  /** Discord ids of members currently holding the role. */
  holders: Set<string>;
  /** Discord ids of every guild member. */
  memberIds: Set<string>;
}

async function fetchRole(guild: Guild, roleId: string): Promise<Role | null> {
  try {
    return await guild.roles.fetch(roleId);
  } catch {
    return null;
  }
}

function roleProblems(guild: Guild, role: Role | null): Problem[] {
  if (!role || role.id === guild.id) {
    return [{ code: 'role_not_found', message: 'That role does not exist.' }];
  }
  const out: Problem[] = [];
  if (role.managed) {
    out.push({
      code: 'role_managed',
      message: `@${role.name} is managed by an integration and cannot be assigned.`,
    });
  }
  const me = guild.members.me;
  if (me && me.roles.highest.comparePositionTo(role) <= 0) {
    out.push({
      code: 'role_above_bot',
      message: `Move the bot's role above @${role.name} in Server Settings → Roles.`,
    });
  }
  return out;
}

/**
 * Can the bot manage `roleId`? `roleId: null` checks only what creating a new
 * role needs (connected + Manage Roles).
 */
export async function preflightGameRole(
  guild: Guild | null,
  roleId: string | null,
): Promise<GameRolePreflightDto> {
  if (!guild) {
    const message = 'The Discord bot is not connected.';
    return { ok: false, problems: [{ code: 'bot_disconnected', message }] };
  }
  const problems: Problem[] = [];
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    problems.push({
      code: 'missing_manage_roles',
      message: 'The bot needs the Manage Roles permission.',
    });
  }
  if (roleId !== null) {
    problems.push(...roleProblems(guild, await fetchRole(guild, roleId)));
  }
  return { ok: problems.length === 0, problems };
}

/** Create a mentionable, permission-less role at the bottom of the list. */
export async function createGameRole(
  guild: Guild,
  name: string,
): Promise<{ id: string; name: string }> {
  const role = await guild.roles.create({
    name: name.trim().slice(0, 100),
    mentionable: true,
    permissions: [],
    reason: 'Raid Ledger: auto-maintained game role',
  });
  return { id: role.id, name: role.name };
}

/** Best-effort delete of a role the bot just created (orphan cleanup). */
export async function deleteCreatedRole(
  guild: Guild,
  roleId: string,
): Promise<void> {
  await guild.roles
    .delete(roleId, 'Raid Ledger: game role link failed preflight')
    .catch(() => undefined);
}

export type GuildMembers = Collection<string, GuildMember>;

/** Discord's max page size for `GET /guilds/{id}/members`. */
export const MEMBER_PAGE_SIZE = 1000;
/** Page bound: 250k members, far past any guild this app serves. */
export const MAX_MEMBER_PAGES = 250;
/** Longest rate-limit wait honoured before the single retry. */
const MAX_RATE_LIMIT_WAIT_MS = 60_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait (ms) a rate-limit error asks for, or null when `err` is not one.
 * Gateway op-8 limits carry `data.retry_after` in seconds; REST
 * `RateLimitError` carries `retryAfter` in ms.
 */
function rateLimitDelayMs(err: unknown): number | null {
  if (typeof err !== 'object' || err === null || !('name' in err)) return null;
  if (err.name === 'GatewayRateLimitError' && 'data' in err) {
    const data = err.data as { retry_after?: unknown } | null;
    const secs = typeof data?.retry_after === 'number' ? data.retry_after : 1;
    return Math.ceil(secs * 1000);
  }
  // @discordjs/rest names it `RateLimitError[<route>]`, never bare.
  const isRest =
    err instanceof RateLimitError ||
    (typeof err.name === 'string' && err.name.startsWith('RateLimitError'));
  if (isRest && 'retryAfter' in err) {
    return typeof err.retryAfter === 'number' ? err.retryAfter : 1000;
  }
  return null;
}

/** Run `op`; on a rate limit wait it out (capped) and retry exactly once. */
export async function withRateLimitRetry<T>(
  op: () => Promise<T>,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<T> {
  try {
    return await op();
  } catch (err) {
    const delay = rateLimitDelayMs(err);
    if (delay === null) throw err;
    await wait(Math.min(delay, MAX_RATE_LIMIT_WAIT_MS));
    return op();
  }
}

async function listAllMembers(guild: Guild): Promise<GuildMembers> {
  const all: GuildMembers = new Collection();
  let after: string | undefined;
  for (let i = 0; i < MAX_MEMBER_PAGES; i++) {
    const page = await guild.members.list({
      limit: MEMBER_PAGE_SIZE,
      ...(after !== undefined ? { after } : {}),
    });
    for (const [id, m] of page) all.set(id, m);
    after = page.lastKey();
    if (page.size < MEMBER_PAGE_SIZE || after === undefined) return all;
  }
  // A truncated list would read every unlisted holder as departed and
  // revoke their grants, so a cap hit fails the run instead.
  throw new Error(
    `Guild member list incomplete: stopped at the ${MAX_MEMBER_PAGES}-page cap`,
  );
}

/**
 * The full member list; a run fetches it once and shares it across games.
 * Pages the REST list endpoint, NOT `members.fetch()`: that is a gateway
 * op-8 request, rate limited per shard and shared with every member search
 * the bot makes, so a busy shard failed the whole reconcile.
 */
export function fetchGuildMembers(
  guild: Guild,
  wait?: (ms: number) => Promise<void>,
): Promise<GuildMembers> {
  return withRateLimitRetry(() => listAllMembers(guild), wait);
}

/** Holders + member ids from ONE member fetch; null when the role is gone. */
export async function fetchRoleState(
  guild: Guild | null,
  roleId: string,
  prefetched?: GuildMembers,
): Promise<RoleState | null> {
  if (!guild) return null;
  const role = await fetchRole(guild, roleId);
  if (!role) return null;
  const members = prefetched ?? (await fetchGuildMembers(guild));
  const holders = new Set<string>();
  for (const [id, m] of members) if (m.roles.cache.has(roleId)) holders.add(id);
  return { holders, memberIds: new Set(members.keys()) };
}

/** Whether one member holds the role; null when they are not in the guild. */
export async function memberHoldsRole(
  guild: Guild,
  discordUserId: string,
  roleId: string,
): Promise<boolean | null> {
  try {
    const member = await guild.members.fetch(discordUserId);
    return member.roles.cache.has(roleId);
  } catch (err) {
    if (isUnknownMember(err)) return null;
    throw err;
  }
}

/**
 * Cache-only (no REST call): true when the gateway-cached member exists and
 * lacks the role — e.g. it was removed by hand. Uncached → false.
 */
export function cachedMemberLacksRole(
  guild: Guild,
  discordUserId: string,
  roleId: string,
): boolean {
  const member = guild.members.cache.get(discordUserId);
  return member !== undefined && !member.roles.cache.has(roleId);
}

function isUnknownMember(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    err.code === UNKNOWN_MEMBER
  );
}

async function mutate(op: () => Promise<unknown>): Promise<boolean> {
  try {
    await op();
    return true;
  } catch (err) {
    if (isUnknownMember(err)) return false;
    throw err;
  }
}

/** Give the role. False (no throw) when the member left the guild. */
export function addMemberRole(
  guild: Guild,
  discordUserId: string,
  roleId: string,
  reason: string,
): Promise<boolean> {
  return mutate(() =>
    guild.members.addRole({ user: discordUserId, role: roleId, reason }),
  );
}

/** Take the role. False (no throw) when the member left the guild. */
export function removeMemberRole(
  guild: Guild,
  discordUserId: string,
  roleId: string,
  reason: string,
): Promise<boolean> {
  return mutate(() =>
    guild.members.removeRole({ user: discordUserId, role: roleId, reason }),
  );
}

/** Assignable roles for the admin picker (not @everyone, not managed). */
export function listAssignableRoles(
  guild: Guild | null,
): { id: string; name: string; assignable: boolean }[] {
  if (!guild) return [];
  const me = guild.members.me;
  return [...guild.roles.cache.values()]
    .filter((r) => r.id !== guild.id && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({
      id: r.id,
      name: r.name,
      assignable: !!me && me.roles.highest.comparePositionTo(r) > 0,
    }));
}
