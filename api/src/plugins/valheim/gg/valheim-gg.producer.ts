/**
 * ROK-2187 metric 11 — the Valheim GG card (owner `valheim`): deaths and
 * skill gains on the user's claimed characters within the GG year.
 *
 * - Deaths: `valheim_player_deaths` rows in the community-tz window whose
 *   `steam_id` is the steam id of a profile the user claimed, counted once
 *   each. The screenshot classifier can delete a death (it merges a
 *   `discord` death into a log/mod one), so a later recompute may dip; the
 *   frozen snapshot keeps whatever this run counted.
 * - Skill gains: per claimed character, the last play day's end skills −
 *   the first play day's start skills in the year (effective levels; play
 *   dates are already local `YYYY-MM-DD`). The importer keeps only the
 *   newest play days per profile, so this is the gain over what survives.
 */
import { and, asc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import type { GgValheimCard, ValheimSkill } from '@raid-ledger/contract';
import * as schema from '../../../drizzle/schema';
import type { GgCardContext } from '../../core/gg/gg-card.registry';
import {
  SKILL_TREND_MIN_GAIN,
  effectiveLevel,
} from '../armory/read/valheim-skill-trend.mappers';

const { valheimPlayerDeaths: deaths, valheimProfiles: profiles } = schema;
const days = schema.valheimProfileSkillDays;

/** The schema's cap on listed skills. */
const MAX_SKILLS = 20;

/** One claimed character's play day in the year. */
export interface ValheimYearDayRow {
  profileId: number;
  playDate: string;
  startSkills: ValheimSkill[];
  endSkills: ValheimSkill[];
}

/** skillId → last end − first start for one character's ordered days. */
function characterGains(rows: readonly ValheimYearDayRow[]): Map<string, number> {
  const first = rows[0];
  const last = rows[rows.length - 1];
  const gains = new Map<string, number>();
  if (first === undefined || last === undefined) return gains;
  const start = new Map(first.startSkills.map((s) => [s.id, effectiveLevel(s)]));
  for (const s of last.endSkills) {
    gains.set(s.id, effectiveLevel(s) - (start.get(s.id) ?? 0));
  }
  return gains;
}

/** Rows grouped per character, each group in play-date order. */
function byCharacter(rows: readonly ValheimYearDayRow[]): ValheimYearDayRow[][] {
  const groups = new Map<number, ValheimYearDayRow[]>();
  for (const r of rows) groups.set(r.profileId, [...(groups.get(r.profileId) ?? []), r]);
  return [...groups.values()].map((g) =>
    [...g].sort((a, b) => (a.playDate < b.playDate ? -1 : 1)),
  );
}

/** The card from the year's death count and play days; `null` = nothing to show. */
export function toValheimYearCard(
  deathCount: number,
  rows: readonly ValheimYearDayRow[],
): GgValheimCard | null {
  const characters = byCharacter(rows);
  const totals = new Map<string, number>();
  for (const g of characters) {
    for (const [id, gain] of characterGains(g)) {
      totals.set(id, (totals.get(id) ?? 0) + gain);
    }
  }
  const skillGains = [...totals]
    .filter(([, gained]) => gained >= SKILL_TREND_MIN_GAIN)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_SKILLS)
    .map(([skill, gained]) => ({ skill, gained: Math.round(gained * 100) / 100 }));
  if (deathCount === 0 && skillGains.length === 0) return null;
  return { characters: characters.length, deaths: deathCount, skillGains };
}

/** Deaths in `[start, end)` attributed to a steam id the user claimed. */
async function countYearDeaths(ctx: GgCardContext): Promise<number> {
  const [row] = await ctx.db
    .select({ deaths: sql<number>`count(DISTINCT ${deaths.id})::int` })
    .from(deaths)
    .innerJoin(
      profiles,
      and(eq(profiles.steamId, deaths.steamId), eq(profiles.claimedBy, ctx.userId)),
    )
    .where(and(gte(deaths.occurredAt, ctx.window.start), lt(deaths.occurredAt, ctx.window.end)));
  return Number(row?.deaths ?? 0);
}

/** The user's claimed characters' play days within calendar `year`. */
function selectYearDays(ctx: GgCardContext): Promise<ValheimYearDayRow[]> {
  return ctx.db
    .select({
      profileId: days.profileId,
      playDate: days.playDate,
      startSkills: days.startSkills,
      endSkills: days.endSkills,
    })
    .from(days)
    .innerJoin(profiles, eq(profiles.id, days.profileId))
    .where(
      and(
        eq(profiles.claimedBy, ctx.userId),
        gte(days.playDate, `${ctx.year}-01-01`),
        lte(days.playDate, `${ctx.year}-12-31`),
      ),
    )
    .orderBy(asc(days.profileId), asc(days.playDate));
}

/** The registered producer: `null` when the user has nothing Valheim this year. */
export async function valheimYearProducer(
  ctx: GgCardContext,
): Promise<GgValheimCard | null> {
  const deathCount = await countYearDeaths(ctx);
  return toValheimYearCard(deathCount, await selectYearDays(ctx));
}
