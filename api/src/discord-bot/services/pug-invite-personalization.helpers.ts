/**
 * ROK-1462 (slice D) — sourcing for the PUG invite's personalized fields.
 *
 * "In your library · 142 hrs played" is the whole point of sending a DM rather
 * than posting in a channel (design 2026-09-01, "Two grammars"). This module is
 * the only place that data is fetched, and it has one hard rule: it NEVER
 * throws and never blocks the invite. A dead database, an unlinked Discord
 * account or a gameless event all degrade to "no personalized fields" — the DM
 * still goes out, just without the badge.
 *
 * Ownership semantics match `lineups/viewer-interests.helpers.ts`:
 * `steam_library` = owned, `steam_wishlist` = wishlisted, `manual` = a heart
 * (a want-to-play, NEVER ownership). Priority is fixed at owned > wishlist >
 * hearted and the list is capped at two (spec D2).
 */
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  personalizedFieldName,
  type PersonalizedField,
  type PersonalizedKind,
} from '../embeds/embed-personalized.helpers';
import {
  priceBadge,
  type GameBadgeInputs,
} from '../embeds/embed-badges.helpers';
import { EMBED_GAME_BADGE_COLUMNS } from './embed-game.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** What a PUG invite DM may say about its single reader. */
export interface PugPersonalization {
  /** At most two, already prioritised. */
  fields: PersonalizedField[];
  /** Game cover art for the embed thumbnail. */
  coverUrl: string | null;
}

/** The degraded answer: a DM with no badges is still a valid DM. */
const NOTHING: PugPersonalization = { fields: [], coverUrl: null };

/** Inputs for one invite's lookup. */
export interface PugPersonalizationInput {
  /** The invitee's Discord snowflake; null skips the reader-specific half. */
  discordUserId?: string | null;
  gameId?: number | null;
  /** Epoch ms, used only for the price badge's staleness marker. */
  now?: number;
}

type GameRow = GameBadgeInputs & { coverUrl: string | null };
type InterestRow = {
  source: string;
  playtimeForever: number | null;
  createdAt: Date;
};

/** `142 hrs played`, or `Owned` when Steam never reported a playtime. */
function ownedValue(minutes: number | null): string {
  const hours = minutes == null ? 0 : Math.round(minutes / 60);
  if (hours < 1) return 'Owned';
  return `${hours} hr${hours === 1 ? '' : 's'} played`;
}

/** The live deal text, or the bare `Wishlisted` when there is no price. */
function wishlistValue(game: GameRow | null, now: number): string {
  const badge = game ? priceBadge(game, now) : null;
  return badge?.value ?? 'Wishlisted';
}

/** `on 14 Jun` — when the reader hearted the game. */
function heartedValue(createdAt: Date): string {
  return `on ${createdAt.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })}`;
}

/** One canonical field for a kind, so no call site invents a name. */
function field(kind: PersonalizedKind, value: string): PersonalizedField {
  return { kind, name: personalizedFieldName(kind), value };
}

/**
 * Turn the interest rows into <=2 fields at the fixed priority (spec D2).
 *
 * The order is deliberate and NOT data-driven: owning the game is the most
 * useful thing to tell someone being asked to fill a slot, a live deal is the
 * next best nudge, and a heart is the weakest signal of the three.
 */
function toFields(
  rows: InterestRow[],
  game: GameRow | null,
  now: number,
): PersonalizedField[] {
  const bySource = (source: string) => rows.find((r) => r.source === source);
  const owned = bySource('steam_library');
  const wishlisted = bySource('steam_wishlist');
  const hearted = bySource('manual');
  const fields: PersonalizedField[] = [];
  if (owned) fields.push(field('owned', ownedValue(owned.playtimeForever)));
  if (wishlisted) fields.push(field('wishlist', wishlistValue(game, now)));
  if (hearted) fields.push(field('hearted', heartedValue(hearted.createdAt)));
  return fields.slice(0, 2);
}

/** The badge columns + cover for one game, or null if the read fails. */
async function loadGame(db: Db, gameId: number): Promise<GameRow | null> {
  const [row] = await db
    .select({ ...EMBED_GAME_BADGE_COLUMNS, coverUrl: schema.games.coverUrl })
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .limit(1);
  return row ?? null;
}

/** The reader's interest rows for this game, or `[]` when they have none. */
async function loadInterests(
  db: Db,
  discordUserId: string,
  gameId: number,
): Promise<InterestRow[]> {
  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.discordId, discordUserId))
    .limit(1);
  if (!user) return [];

  return db
    .select({
      source: schema.gameInterests.source,
      playtimeForever: schema.gameInterests.playtimeForever,
      createdAt: schema.gameInterests.createdAt,
    })
    .from(schema.gameInterests)
    .where(
      and(
        eq(schema.gameInterests.userId, user.id),
        eq(schema.gameInterests.gameId, gameId),
      ),
    )
    .limit(8);
}

/**
 * Load the ≤2 personalized fields and the cover art for a PUG invite DM.
 *
 * Swallows every failure by design — this runs on a notification path, where a
 * missing badge is a cosmetic loss and a thrown error is a lost invite.
 *
 * @param db - Drizzle handle.
 * @param input - Invitee snowflake, game id and the clock for price staleness.
 * @returns Fields in priority order plus the cover URL; both degrade to empty.
 */
export async function loadPugInvitePersonalization(
  db: Db,
  input: PugPersonalizationInput,
): Promise<PugPersonalization> {
  const gameId = input.gameId;
  if (gameId == null) return { ...NOTHING };

  const game = await loadGame(db, gameId).catch(() => undefined);
  if (game === undefined) return { ...NOTHING };

  const coverUrl = game?.coverUrl ?? null;
  if (!input.discordUserId) return { fields: [], coverUrl };

  try {
    const rows = await loadInterests(db, input.discordUserId, gameId);
    return { fields: toFields(rows, game, input.now ?? Date.now()), coverUrl };
  } catch {
    return { fields: [], coverUrl };
  }
}

/**
 * Confirmed signups on an event — the `7` in `7 of 8 signed up`.
 *
 * Lives beside the personalization lookup because it shares its contract: the
 * invite DM must go out even when the count cannot be read, so a failure is
 * reported as `0` rather than raised.
 *
 * @param db - Drizzle handle.
 * @param eventId - The event whose roster is being quoted.
 * @returns The `signed_up` count, or 0 on any failure.
 */
export async function countSignedUp(db: Db, eventId: number): Promise<number> {
  try {
    const [row] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(schema.eventSignups)
      .where(
        and(
          eq(schema.eventSignups.eventId, eventId),
          eq(schema.eventSignups.status, 'signed_up'),
        ),
      )
      .limit(1);
    return typeof row?.value === 'number' ? row.value : 0;
  } catch {
    return 0;
  }
}

/** Everything the PUG invite DM's body needs, loaded in one round of reads. */
export interface PugInviteData extends PugPersonalization {
  signupCount: number;
}

/**
 * Load the personalized fields, the cover and the roster count together.
 *
 * One call so the service does not have to know that three of these come from
 * one degrading lookup and the fourth from another.
 *
 * @param db - Drizzle handle.
 * @param input - Personalization inputs plus the event whose roster is quoted.
 * @returns Fields, cover URL and signup count; every part degrades, none throw.
 */
export async function loadPugInviteData(
  db: Db,
  input: PugPersonalizationInput & { eventId: number },
): Promise<PugInviteData> {
  const [personal, signupCount] = await Promise.all([
    loadPugInvitePersonalization(db, input),
    countSignedUp(db, input.eventId),
  ]);
  return { ...personal, signupCount };
}
