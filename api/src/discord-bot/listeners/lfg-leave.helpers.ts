/**
 * ROK-1660 — leave one LFG group and word the result.
 *
 * One helper so every leave surface (the board post's `I'm out`, the
 * `Leave · {game}` list buttons, `/lfg-leave`) says the same thing about the
 * same outcome. The write is always `LfgService.withdraw` — there is no second
 * write path.
 */
import { NotFoundException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import { LFG_BUTTON_IDS } from '../discord-bot.constants';
import {
  buildLfgBoardCustomId,
  parseLfgBoardCustomId,
  type LfgBoardButtonRef,
} from '../lfg-board/lfg-board-custom-id.helpers';

/** The slice of `LfgService` a leave needs. */
export interface LfgLeaveWriter {
  /** `group` absent = every hand of the game (ROK-2352). */
  withdraw(userId: number, gameId: number, group?: string): Promise<void>;
  /** Game-scoped, so a group past the `GET /lfg` cap still counts. */
  countStillLooking(gameId: number): Promise<number>;
}

/** What one leave did. `stillLooking` is the group's count AFTER the leave. */
export interface LfgLeaveOutcome {
  left: boolean;
  stillLooking: number;
}

/** Copy for any thrown failure on a leave surface. */
export const LFG_LEAVE_ERROR_REPLY = 'Something went wrong. Please try again.';

/**
 * The custom id the board post's `I'm out` button carries. ROK-2352: a keyed
 * group's post appends its key (v2); `''` stays the v1 id.
 */
export function leaveCustomId(gameId: number, groupKey = ''): string {
  return buildLfgBoardCustomId(LFG_BUTTON_IDS.LEAVE, gameId, groupKey);
}

/**
 * Parse an `I'm out` button's custom id.
 *
 * Disjoint from `lfg:withdraw:` and `lfg:join:` by prefix, so no press is ever
 * claimed by two listeners.
 *
 * @param customId - The interaction's custom id.
 * @returns The game id, or null when this is not a leave button.
 */
export function parseLeaveCustomId(customId: string): number | null {
  return parseLeavePress(customId)?.gameId ?? null;
}

/**
 * ROK-2352 — parse an `I'm out` id, v1 (`''` group) or v2 (keyed group).
 *
 * @param customId - The interaction's custom id.
 * @returns Game + group, or null when this is not a leave button.
 */
export function parseLeavePress(customId: string): LfgBoardButtonRef | null {
  return parseLfgBoardCustomId(customId, LFG_BUTTON_IDS.LEAVE);
}

/**
 * `You're out — **{game}**. {n} still looking.` — the count is dropped when
 * nobody is left (or when the caller does not report one).
 */
export function buildLeftReply(gameName: string, stillLooking = 0): string {
  const lead = `You're out — **${gameName}**.`;
  return stillLooking > 0 ? `${lead} ${stillLooking} still looking.` : lead;
}

/** The reply when the caller had no hand up for the game. */
export function buildNotInGroupReply(gameName: string): string {
  return `You're not in the **${gameName}** group.`;
}

/**
 * Withdraw the caller's hand; `false` when there was none.
 *
 * `LfgService.withdraw` 404s when there is no active row (already left,
 * expired, converted). That is a normal outcome of a stale button, not an
 * error — every OTHER failure still propagates.
 */
export async function withdrawIfPresent(
  lfg: Pick<LfgLeaveWriter, 'withdraw'>,
  userId: number,
  gameId: number,
  group?: string,
): Promise<boolean> {
  try {
    // ROK-2352: no `group` = every hand (the pre-ROK-2352 call, unchanged).
    await (group === undefined
      ? lfg.withdraw(userId, gameId)
      : lfg.withdraw(userId, gameId, group));
    return true;
  } catch (error) {
    if (error instanceof NotFoundException) return false;
    throw error;
  }
}

/** Leave one group and read how many are still looking in it. */
export async function leaveOneGroup(
  lfg: LfgLeaveWriter,
  userId: number,
  gameId: number,
  group?: string,
): Promise<LfgLeaveOutcome> {
  if (!(await withdrawIfPresent(lfg, userId, gameId, group))) {
    return { left: false, stillLooking: 0 };
  }
  return { left: true, stillLooking: await lfg.countStillLooking(gameId) };
}

/** The game's display name for the reply copy. */
export async function lookupLfgGameName(
  db: PostgresJsDatabase<typeof schema>,
  gameId: number,
): Promise<string> {
  const [game] = await db
    .select({ name: schema.games.name })
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .limit(1);
  return game?.name ?? 'that game';
}
