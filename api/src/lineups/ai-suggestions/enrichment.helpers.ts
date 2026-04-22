import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  AiSuggestionDto,
  AiSuggestionsLlmOutputDto,
} from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Aggregated metadata fetched for every suggested gameId in a single
 * round-trip. Mirrors `CommonGroundRow` minus the scoring inputs —
 * enough to render a suggestion card with full badge parity.
 */
interface SuggestionRow {
  gameId: number;
  gameName: string;
  slug: string;
  coverUrl: string | null;
  ownershipCount: number;
  wishlistCount: number;
  nonOwnerPrice: number | null;
  itadCurrentCut: number | null;
  itadCurrentShop: string | null;
  itadCurrentUrl: string | null;
  earlyAccess: boolean;
  itadTags: string[];
  playerCount: { min: number; max: number } | null;
}

/**
 * Fetch name + cover + pricing + player count + ownership counts for
 * the voter set in a single query so every AI-suggested card can
 * render as if it came from Common Ground. When `gameIds` or
 * `voterIds` are empty the corresponding columns default to 0.
 */
async function loadSuggestionMeta(
  db: Db,
  gameIds: number[],
  voterIds: number[],
): Promise<SuggestionRow[]> {
  if (gameIds.length === 0) return [];
  const voterFilter =
    voterIds.length > 0
      ? sql`AND gi.user_id IN (${sql.join(
          voterIds.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql`AND FALSE`;
  const rows = (await db.execute(sql`
    SELECT
      g.id AS "gameId",
      g.name AS "gameName",
      g.slug,
      g.cover_url AS "coverUrl",
      COALESCE(COUNT(*) FILTER (WHERE gi.source = 'steam_library' ${voterFilter}), 0)::int AS "ownershipCount",
      COALESCE(COUNT(*) FILTER (WHERE gi.source = 'steam_wishlist'), 0)::int AS "wishlistCount",
      CASE WHEN g.itad_current_price IS NOT NULL THEN g.itad_current_price::float ELSE NULL END AS "nonOwnerPrice",
      g.itad_current_cut AS "itadCurrentCut",
      g.itad_current_shop AS "itadCurrentShop",
      g.itad_current_url AS "itadCurrentUrl",
      g.early_access AS "earlyAccess",
      COALESCE(g.itad_tags, '[]'::jsonb) AS "itadTags",
      g.player_count AS "playerCount"
    FROM games g
    LEFT JOIN game_interests gi ON gi.game_id = g.id
    WHERE g.id IN (${sql.join(
      gameIds.map((id) => sql`${id}`),
      sql`, `,
    )})
    GROUP BY g.id
  `)) as unknown as SuggestionRow[];
  return rows;
}

/**
 * Merge the LLM's `{gameId, confidence, reasoning}` list with
 * server-fetched metadata to produce the full response DTO.
 * Suggestions whose `gameId` isn't in the candidate pool (or whose
 * game row cannot be found) are dropped silently.
 */
export async function enrichSuggestions(
  db: Db,
  llmOutput: AiSuggestionsLlmOutputDto,
  knownGameIds: Set<number>,
  voterIds: number[],
): Promise<AiSuggestionDto[]> {
  const filtered = llmOutput.suggestions.filter((s) =>
    knownGameIds.has(s.gameId),
  );
  if (filtered.length === 0) return [];
  const meta = await loadSuggestionMeta(
    db,
    filtered.map((s) => s.gameId),
    voterIds,
  );
  const metaById = new Map(meta.map((m) => [m.gameId, m]));
  const voterTotal = voterIds.length;
  return filtered
    .filter((s) => metaById.has(s.gameId))
    .map((s) => {
      const row = metaById.get(s.gameId);
      if (!row) throw new Error(`Game ${s.gameId} missing after filter`);
      return {
        gameId: row.gameId,
        name: row.gameName,
        slug: row.slug,
        coverUrl: row.coverUrl,
        confidence: s.confidence,
        reasoning: s.reasoning,
        ownershipCount: row.ownershipCount,
        voterTotal,
        wishlistCount: row.wishlistCount,
        nonOwnerPrice: row.nonOwnerPrice,
        itadCurrentCut: row.itadCurrentCut,
        itadCurrentShop: row.itadCurrentShop,
        itadCurrentUrl: row.itadCurrentUrl,
        earlyAccess: row.earlyAccess,
        itadTags: row.itadTags ?? [],
        playerCount: row.playerCount,
      };
    });
}
