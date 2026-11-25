/**
 * ROK-2352 §3.3 — the WoW per-hand detail (`wow_lfg_hand_details`): roles
 * (1..3, required) and an optional character that must be the caller's own
 * on this game. Validated and written inside core's per-game-locked tx.
 */
import { BadRequestException } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  WowLfgHandDetailSchema,
  type CreateSignupDto,
  type WowLfgHandDetailDto,
  type WowLfgMemberDetailDto,
  type WowLfgRole,
} from '@raid-ledger/contract';
import * as schema from '../../../drizzle/schema';

/** Any drizzle handle (the db or core's tx). */
export type WowLfgDb = PostgresJsDatabase<typeof schema>;

/** A stored detail, as the last-detail memory returns it. */
export interface WowLfgStoredDetail {
  roles: WowLfgRole[];
  characterId: string | null;
}

const ROLES: readonly string[] = ['tank', 'healer', 'dps'];

/** Type guard over the DB's `text[]` (its CHECK already limits the values). */
function isWowRole(r: string): r is WowLfgRole {
  return ROLES.includes(r);
}

/**
 * Parse a raw `handDetail` → the WoW detail, or 400.
 *
 * @param detail - Client-supplied, unvalidated.
 */
export function parseWowHandDetail(detail: unknown): WowLfgHandDetailDto {
  const parsed = WowLfgHandDetailSchema.safeParse(detail);
  if (!parsed.success) {
    throw new BadRequestException(
      `Invalid WoW LFG detail: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
    );
  }
  return parsed.data;
}

/**
 * 400 unless the character is the user's own, on this game.
 *
 * @param db - Handle (core's tx on the write path).
 * @param characterId - The picked character.
 * @param who - The hand's owner and game.
 */
export async function assertOwnCharacter(
  db: WowLfgDb,
  characterId: string,
  who: { userId: number; gameId: number },
): Promise<void> {
  const c = schema.characters;
  const rows = await db
    .select({ id: c.id })
    .from(c)
    .where(
      and(
        eq(c.id, characterId),
        eq(c.userId, who.userId),
        eq(c.gameId, who.gameId),
      ),
    )
    .limit(1);
  if (rows.length === 0) {
    throw new BadRequestException(
      'The character must be one of your own characters for this game',
    );
  }
}

/**
 * Insert or replace a hand's detail.
 *
 * @param db - Core's tx.
 * @param intentId - The hand.
 * @param detail - Validated detail.
 */
export async function upsertWowHandDetail(
  db: WowLfgDb,
  intentId: number,
  detail: WowLfgHandDetailDto,
): Promise<void> {
  const values = {
    roles: [...detail.roles],
    characterId: detail.characterId ?? null,
    updatedAt: new Date(),
  };
  await db
    .insert(schema.wowLfgHandDetails)
    .values({ intentId, ...values })
    .onConflictDoUpdate({ target: schema.wowLfgHandDetails.intentId, set: values });
}

/**
 * intentId → the member detail (roles + character name/class) for a group view.
 *
 * @param db - Handle.
 * @param intentIds - Hands asked about; unknown ids are absent from the map.
 */
export async function readWowMemberDetails(
  db: WowLfgDb,
  intentIds: number[],
): Promise<Map<number, WowLfgMemberDetailDto>> {
  if (intentIds.length === 0) return new Map();
  const d = schema.wowLfgHandDetails;
  const c = schema.characters;
  const rows = await db
    .select({
      intentId: d.intentId,
      roles: d.roles,
      characterId: d.characterId,
      characterName: c.name,
      characterClass: c.class,
    })
    .from(d)
    .leftJoin(c, eq(c.id, d.characterId))
    .where(inArray(d.intentId, intentIds));
  return new Map(
    rows.map((r) => [r.intentId, { ...r, roles: r.roles.filter(isWowRole) }]),
  );
}

/**
 * userId → the signup fields a converted hand carries (character + roles).
 * A user with several of the hands keeps the most recently updated one.
 *
 * @param db - Handle (core's tx at lock-in).
 * @param intentIds - The converted hands.
 */
export async function readWowCarryover(
  db: WowLfgDb,
  intentIds: number[],
): Promise<Map<number, CreateSignupDto>> {
  const out = new Map<number, CreateSignupDto>();
  if (intentIds.length === 0) return out;
  const d = schema.wowLfgHandDetails;
  const i = schema.lfgIntents;
  const rows = await db
    .select({ userId: i.userId, roles: d.roles, characterId: d.characterId })
    .from(d)
    .innerJoin(i, eq(i.id, d.intentId))
    .where(inArray(d.intentId, intentIds))
    .orderBy(desc(d.updatedAt));
  for (const r of rows) {
    if (out.has(r.userId)) continue;
    out.set(r.userId, {
      preferredRoles: r.roles.filter(isWowRole),
      ...(r.characterId !== null ? { characterId: r.characterId } : {}),
    });
  }
  return out;
}

/**
 * The user's most recent hand detail on a game (pre-fill + Discord hands, Q8),
 * or null when they never set one.
 *
 * @param db - Handle.
 * @param who - User and game.
 */
export async function readWowLastDetail(
  db: WowLfgDb,
  who: { userId: number; gameId: number },
): Promise<WowLfgStoredDetail | null> {
  const d = schema.wowLfgHandDetails;
  const i = schema.lfgIntents;
  const [row] = await db
    .select({ roles: d.roles, characterId: d.characterId })
    .from(d)
    .innerJoin(i, eq(i.id, d.intentId))
    .where(and(eq(i.userId, who.userId), eq(i.gameId, who.gameId)))
    .orderBy(desc(d.updatedAt))
    .limit(1);
  return row ? { roles: row.roles.filter(isWowRole), characterId: row.characterId } : null;
}
