import { sql, type SQL } from 'drizzle-orm';
import { MULTIPLAYER_TAGS } from '../multiplayer-tags.constants';

/**
 * Multiplayer eligibility for similarity results (ROK-931, ROK-1939).
 *
 * Community Lineup is group play, so `multiplayerOnly` drops solo-only
 * titles. Eligibility used to be inferred purely from the group-play taste
 * axes, which leaned on "IGDB Multiplayer / Multiplayer tag → pvp". ROK-1939
 * D9 narrowed pvp to explicitly competitive vocabulary, so a game tagged only
 * FPS / Shooter / Multiplayer now scores 0 on every group axis — and would
 * vanish from lineup suggestions. Eligibility therefore reads the game's own
 * multiplayer metadata directly, independent of how pvp is scored.
 */

/** IGDB game modes that mean "more than one person plays". */
export const IGDB_MULTIPLAYER_MODES: readonly number[] = [
  2, // Multiplayer
  3, // Co-operative
  4, // Split screen
  5, // MMO
  6, // Battle Royale
];

/** Lowercased shared multiplayer tags, matched case-insensitively. */
const MULTIPLAYER_TAGS_LOWER: readonly string[] = MULTIPLAYER_TAGS.map((t) =>
  t.toLowerCase(),
);

const GROUP_PLAY_AXES = ['pvp', 'co_op', 'mmo', 'battle_royale', 'moba'];

function groupAxisPredicate(): SQL {
  const parts = GROUP_PLAY_AXES.map(
    (axis) => sql`(gtv.dimensions->>${axis})::float > 0`,
  );
  return sql.join(parts, sql` OR `);
}

function igdbModePredicate(): SQL {
  const parts = IGDB_MULTIPLAYER_MODES.map(
    (mode) => sql`g.game_modes @> ${JSON.stringify([mode])}::jsonb`,
  );
  return sql.join(parts, sql` OR `);
}

function multiplayerTagPredicate(): SQL {
  const tags = sql.join(
    MULTIPLAYER_TAGS_LOWER.map((t) => sql`${t}`),
    sql`, `,
  );
  return sql`EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(g.itad_tags) = 'array'
           THEN g.itad_tags ELSE '[]'::jsonb END
    ) AS t(tag)
    WHERE lower(t.tag) IN (${tags})
  )`;
}

/**
 * `AND (...)` clause keeping a game when ANY multiplayer signal is present:
 * a group-play taste axis, an IGDB multiplayer mode, a shared multiplayer
 * tag, an IGDB player count above one, or a Co-Optimus online capacity above
 * one. A non-array `itad_tags` value counts as no tags rather than failing
 * the whole query. Expects `g` = games and
 * `gtv` = game_taste_vectors in scope.
 */
export function multiplayerEligibilityClause(): SQL {
  return sql`AND (
    ${groupAxisPredicate()}
    OR ${igdbModePredicate()}
    OR ${multiplayerTagPredicate()}
    OR COALESCE((g.player_count->>'max')::numeric, 0) > 1
    OR COALESCE(g.cooptimus_online_max, 0) > 1
  )`;
}
