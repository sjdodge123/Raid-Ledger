import type { DesiredMember } from './game-role-desired.helpers';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Why a bot-granted member no longer qualifies (caller supplies it). */
export type GameRoleRemovalHint =
  | { kind: 'opted_out' }
  | { kind: 'deactivated' }
  | { kind: 'idle'; lastPlayedAt: Date | null };

export interface GameRoleDiffInput {
  /** userId → member who played within the window (findDesiredMembers). */
  desired: ReadonlyMap<number, DesiredMember>;
  /** Discord user ids currently holding the role. */
  holders: ReadonlySet<string>;
  /** userId → Discord user id, for every member the BOT granted the role. */
  grants: ReadonlyMap<number, string>;
  /** Discord user ids currently in the guild. */
  guildMemberIds: ReadonlySet<string>;
  now: Date;
  windowDays: number;
  /** Optional per-user reason for a removal; default is idle. */
  hints?: ReadonlyMap<number, GameRoleRemovalHint>;
}

export interface GameRoleChange {
  userId: number;
  discordUserId: string;
  reason: string;
}

export interface GameRoleDiff {
  /** Give the role and record a grant. */
  add: GameRoleChange[];
  /** Take the role away and delete the grant. */
  remove: GameRoleChange[];
  /** Forget the grant only — no Discord call (role gone or member left). */
  dropGrant: { userId: number; reason: string }[];
}

const ymd = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * ROK-1767: pure diff between who SHOULD hold a game role and who does.
 *
 * - add: desired ∩ guild members − holders.
 * - remove: bot grants ∩ holders − desired. A holder without a grant was
 *   assigned by hand and is never touched.
 * - dropGrant: bot grants whose member no longer holds the role (removed by
 *   hand, or left the guild), unless the same run re-adds them.
 */
export function diffGameRole(input: GameRoleDiffInput): GameRoleDiff {
  const add = computeAdds(input);
  const adding = new Set(add.map((a) => a.userId));
  return {
    add,
    remove: computeRemovals(input),
    dropGrant: computeDrops(input, adding),
  };
}

function computeAdds(input: GameRoleDiffInput): GameRoleChange[] {
  const out: GameRoleChange[] = [];
  for (const [userId, m] of input.desired) {
    if (!input.guildMemberIds.has(m.discordUserId)) continue;
    if (input.holders.has(m.discordUserId)) continue;
    out.push({
      userId,
      discordUserId: m.discordUserId,
      reason: `played ${ymd(m.lastPlayedAt)}`,
    });
  }
  return out;
}

function computeRemovals(input: GameRoleDiffInput): GameRoleChange[] {
  const out: GameRoleChange[] = [];
  for (const [userId, discordUserId] of input.grants) {
    if (input.desired.has(userId)) continue;
    if (!input.holders.has(discordUserId)) continue;
    out.push({ userId, discordUserId, reason: removalReason(input, userId) });
  }
  return out;
}

function computeDrops(
  input: GameRoleDiffInput,
  adding: ReadonlySet<number>,
): { userId: number; reason: string }[] {
  const out: { userId: number; reason: string }[] = [];
  for (const [userId, discordUserId] of input.grants) {
    if (input.holders.has(discordUserId) || adding.has(userId)) continue;
    const left = !input.guildMemberIds.has(discordUserId);
    out.push({ userId, reason: left ? 'left guild' : 'removed by hand' });
  }
  return out;
}

function removalReason(input: GameRoleDiffInput, userId: number): string {
  const hint = input.hints?.get(userId);
  if (hint?.kind === 'opted_out') return 'opted out';
  if (hint?.kind === 'deactivated') return 'deactivated';
  const windowStart = new Date(input.now.getTime() - input.windowDays * DAY_MS);
  return `idle since ${ymd(hint?.lastPlayedAt ?? windowStart)}`;
}
