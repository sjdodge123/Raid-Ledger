/**
 * ROK-2187 metric 12 (Q7) — the WoW "levels dinged" GG card (owner
 * `blizzard`, folder `wow-common`): every `guild_member_level_events` row in
 * the community-tz window whose member row links to one of the user's
 * characters through THE shared `characterLink()` (GUID, else Blizzard id —
 * never re-derived here), with the owner active (`ownerActive`).
 *
 * - Each ding counts once per user: a member row can link to two of the
 *   user's characters (one GUID character with an unknown region), so the
 *   query keeps one row per event — region-matched, then lowest-id
 *   character, the order the recent-dings feed uses.
 * - A junk→twin repair (`blizzard-roster-sync.repair.ts` `moveDings`) moves
 *   the junk row's dings to the twin before deleting it, so they survive and
 *   count once. A guild delete cascades dings away; the frozen snapshot keeps
 *   whatever this run counted.
 * - No latest-snapshot filter: a character that left the guild still dinged.
 */
import { and, asc, eq, gte, lt, sql } from 'drizzle-orm';
import type { GgWowLevelsCard } from '@raid-ledger/contract';
import * as schema from '../../../drizzle/schema';
import type { GgCardContext } from '../../core/gg/gg-card.registry';
import { characterLink, ownerActive } from '../guilds/guild-link.predicates';
import { toWowLevelsCard, type WowYearDingRow } from './wow-gg.helpers';

const { guilds, guildMembers, characters } = schema;
const ev = schema.guildMemberLevelEvents;

/** The user's in-window dings, one row per event. */
function selectYearDings(ctx: GgCardContext): Promise<WowYearDingRow[]> {
  return ctx.db
    .selectDistinctOn([ev.id], {
      eventId: ev.id,
      characterId: characters.id,
      name: characters.name,
      className: sql<
        string | null
      >`coalesce(${characters.class}, ${guildMembers.class})`,
      fromLevel: ev.fromLevel,
      toLevel: ev.toLevel,
    })
    .from(ev)
    .innerJoin(guildMembers, eq(guildMembers.id, ev.guildMemberId))
    .innerJoin(guilds, eq(guilds.id, ev.guildId))
    .innerJoin(characters, characterLink())
    .where(
      and(
        eq(characters.userId, ctx.userId),
        ownerActive(characters.userId),
        gte(ev.occurredAt, ctx.window.start),
        lt(ev.occurredAt, ctx.window.end),
      ),
    )
    .orderBy(ev.id, sql`${characters.region} IS NULL`, asc(characters.id));
}

/** The registered producer: `null` when the user dinged nothing this year. */
export async function wowLevelsYearProducer(
  ctx: GgCardContext,
): Promise<GgWowLevelsCard | null> {
  return toWowLevelsCard(await selectYearDings(ctx));
}
