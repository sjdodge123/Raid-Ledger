import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { GgPeopleCard } from '@raid-ledger/contract';
import {
  eventSignups,
  events,
  eventVoiceSessions,
  users,
} from '../../../../drizzle/schema';
import { personAvatarUrl } from '../../../../guilds/posts/hub-posts.helpers';
import type { GgCardContext } from '../gg-card.registry';
import { ggEventInWindow } from './events.queries';
import {
  rankCoPlayers,
  type GgCoPlayer,
  type GgCoSignupRow,
  type GgCoVoiceRow,
} from './people.helpers';

/** Named people on the card (contract max 3). */
const NAMED_PEOPLE = 3;
/** Ranked candidates looked up to find 3 active ones (bounds the IN list). */
const CANDIDATE_LIMIT = 50;

/** Every linked voice session on the year's events the user was in voice for. */
function loadCoVoice(ctx: GgCardContext): Promise<GgCoVoiceRow[]> {
  const v = eventVoiceSessions;
  const myEvents = ctx.db
    .select({ id: v.eventId })
    .from(v)
    .where(eq(v.userId, ctx.userId));
  return ctx.db
    .select({
      eventId: v.eventId,
      userId: sql<number>`${v.userId}`,
      segments: v.segments,
    })
    .from(v)
    .innerJoin(events, eq(events.id, v.eventId))
    .where(
      and(
        isNotNull(v.userId),
        inArray(v.eventId, myEvents),
        ggEventInWindow(ctx.window),
      ),
    );
}

/** Live signups (co-play graph statuses, no-shows out) on the user's year events. */
function loadCoSignups(ctx: GgCardContext): Promise<GgCoSignupRow[]> {
  const s = eventSignups;
  const live = sql`${s.status} in ('signed_up', 'confirmed')
    and ${s.attendanceStatus} is distinct from 'no_show'`;
  const myEvents = ctx.db
    .select({ id: s.eventId })
    .from(s)
    .where(and(eq(s.userId, ctx.userId), live));
  return ctx.db
    .select({ eventId: s.eventId, userId: sql<number>`${s.userId}` })
    .from(s)
    .innerJoin(events, eq(events.id, s.eventId))
    .where(
      and(
        isNotNull(s.userId),
        live,
        inArray(s.eventId, myEvents),
        ggEventInWindow(ctx.window),
      ),
    );
}

/** Metric 9 (F3) — the owner's ranked co-players for the year: two queries. */
export async function loadYearCoPlayers(
  ctx: GgCardContext,
): Promise<GgCoPlayer[]> {
  const [voice, signups] = await Promise.all([
    loadCoVoice(ctx),
    loadCoSignups(ctx),
  ]);
  return rankCoPlayers(ctx.userId, voice, signups);
}

/** The top 3 ranked co-players who are still active, named for the owner. */
async function nameTopActive(
  ctx: GgCardContext,
  ranked: GgCoPlayer[],
): Promise<GgPeopleCard['people']> {
  const ids = ranked.slice(0, CANDIDATE_LIMIT).map((p) => p.userId);
  if (ids.length === 0) return [];
  const rows = await ctx.db
    .select({
      userId: users.id,
      username: users.username,
      displayName: users.displayName,
      avatar: users.avatar,
      customAvatarUrl: users.customAvatarUrl,
      discordId: users.discordId,
    })
    .from(users)
    .where(and(inArray(users.id, ids), isNull(users.deactivatedAt)));
  const byId = new Map(rows.map((r) => [r.userId, r]));
  return ranked
    .flatMap((p) => {
      const u = byId.get(p.userId);
      if (!u) return [];
      const name = (u.displayName ?? u.username).slice(0, 120);
      return [{ ...p, displayName: name, avatarUrl: personAvatarUrl(u) }];
    })
    .slice(0, NAMED_PEOPLE);
}

/**
 * Core card `people` (owner-only; the public DTO carries only the count).
 * Omitted when no active co-player can be named.
 */
export async function producePeopleCard(
  ctx: GgCardContext,
): Promise<GgPeopleCard | null> {
  const ranked = await loadYearCoPlayers(ctx);
  const people = await nameTopActive(ctx, ranked);
  return people.length === 0
    ? null
    : { people, playedWithCount: ranked.length };
}
