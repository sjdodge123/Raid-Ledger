/**
 * ROK-2352 §3.3 — the hand a `PUT /plugins/wow/lfg/hands/:intentId/detail`
 * edits: the caller's own active hand on a WoW game, or an HTTP error.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import { wowVariantForSlug } from './wow-lfg-catalogue';
import type { WowLfgDb } from './wow-lfg-detail.helpers';

/** The hand being edited. */
export interface WowLfgOwnIntent {
  intentId: number;
  userId: number;
  gameId: number;
}

/**
 * The caller's active hand (404 otherwise — a foreign hand is not leaked),
 * 400 when its game is not a WoW game.
 *
 * @param db - Handle.
 * @param who - Caller and the hand id.
 */
export async function loadOwnWowIntent(
  db: WowLfgDb,
  who: { userId: number; intentId: number },
): Promise<WowLfgOwnIntent> {
  const i = schema.lfgIntents;
  const [row] = await db
    .select({ gameId: i.gameId, slug: schema.games.slug })
    .from(i)
    .innerJoin(schema.games, eq(schema.games.id, i.gameId))
    .where(
      and(
        eq(i.id, who.intentId),
        eq(i.userId, who.userId),
        eq(i.status, 'active'),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundException('Hand not found');
  if (wowVariantForSlug(row.slug) === null) {
    throw new BadRequestException('This hand is not on a WoW game');
  }
  return { ...who, gameId: row.gameId };
}
