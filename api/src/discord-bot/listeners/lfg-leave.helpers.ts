/**
 * ROK-1660 — leave one LFG group and word the result.
 *
 * One helper so every leave surface (the board post's `I'm out`, the
 * `Leave · {game}` list buttons, `/lfg-leave`) says the same thing about the
 * same outcome. The write is always `LfgService.withdraw` — there is no second
 * write path.
 */
import { NotFoundException } from '@nestjs/common';
import type { LfgGroupSummaryDto } from '@raid-ledger/contract';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import { LFG_BUTTON_IDS } from '../discord-bot.constants';

/** The slice of `LfgService` a leave needs. */
export interface LfgLeaveWriter {
  withdraw(userId: number, gameId: number): Promise<void>;
  listGroups(userId: number): Promise<LfgGroupSummaryDto[]>;
}

/** What one leave did. `stillLooking` is the group's count AFTER the leave. */
export interface LfgLeaveOutcome {
  left: boolean;
  stillLooking: number;
}

/** Copy for any thrown failure on a leave surface. */
export const LFG_LEAVE_ERROR_REPLY = 'Something went wrong. Please try again.';

/** The custom id the board post's `I'm out` button carries. */
export function leaveCustomId(gameId: number): string {
  return `${LFG_BUTTON_IDS.LEAVE}:${String(gameId)}`;
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
  const prefix = `${LFG_BUTTON_IDS.LEAVE}:`;
  if (!customId.startsWith(prefix)) return null;
  const raw = customId.slice(prefix.length);
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw);
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
): Promise<boolean> {
  try {
    await lfg.withdraw(userId, gameId);
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
): Promise<LfgLeaveOutcome> {
  if (!(await withdrawIfPresent(lfg, userId, gameId))) {
    return { left: false, stillLooking: 0 };
  }
  const groups = await lfg.listGroups(userId);
  const group = groups.find((g) => g.gameId === gameId);
  return { left: true, stillLooking: group?.activeCount ?? 0 };
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
