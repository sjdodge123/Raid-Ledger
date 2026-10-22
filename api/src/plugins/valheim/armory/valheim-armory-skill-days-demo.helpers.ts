/**
 * ROK-1882 — DEMO_MODE skill history for the armory character fixture
 * (`skillDays: 3`): three play days dated today−1, today−3 and today−6 in
 * the game server's timezone (UTC when it has none), built BACKWARDS from
 * the character's current skills so the newest day ends where the sheet is.
 * Swords gains +2.0 / +1.6 / +0.5 (chip "+4.1 over 3 sessions"); Run is
 * unchanged on the newest day and +1.0 / +0.5 on the older two.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ValheimSkill } from '@raid-ledger/contract';
import * as schema from '../../../drizzle/schema';
import { effectiveLevel } from './read/valheim-skill-trend.mappers';
import { playDateIn, resolvePlayTimezone } from './valheim-skill-days.helpers';

type Db = PostgresJsDatabase<typeof schema>;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The `skillDays` seed option: none (the default) or the 3-day trend. */
export const DEMO_SKILL_DAY_COUNTS = [0, 3] as const;
export type DemoSkillDayCount = (typeof DEMO_SKILL_DAY_COUNTS)[number];

/** Newest first: how many days ago, and each skill's gain that day. */
export const DEMO_SKILL_DAY_PLAN: readonly {
  daysAgo: number;
  gains: Readonly<Record<string, number>>;
}[] = [
  { daysAgo: 1, gains: { Swords: 2.0 } },
  { daysAgo: 3, gains: { Swords: 1.6, Run: 1.0 } },
  { daysAgo: 6, gains: { Swords: 0.5, Run: 0.5 } },
];

/** `end` minus each skill's gain, as a whole effective level (accumulator 0). */
function startOf(
  end: readonly ValheimSkill[],
  gains: Readonly<Record<string, number>>,
): ValheimSkill[] {
  return end.map((s) => ({
    id: s.id,
    level: Math.min(100, Math.max(0, effectiveLevel(s) - (gains[s.id] ?? 0))),
    accumulator: 0,
  }));
}

/** The plan's rows for `profileId`, chaining each day's start into the older day's end. */
export function demoSkillDayRows(
  profileId: number,
  current: readonly ValheimSkill[],
  tz: string,
  now: Date,
): schema.NewValheimProfileSkillDay[] {
  let end: ValheimSkill[] = [...current];
  return DEMO_SKILL_DAY_PLAN.map(({ daysAgo, gains }) => {
    const at = new Date(now.getTime() - daysAgo * DAY_MS);
    const startSkills = startOf(end, gains);
    const row = {
      profileId,
      playDate: playDateIn(at, tz),
      firstSeenAt: at,
      lastSeenAt: at,
      startSkills,
      endSkills: end,
    };
    end = startSkills;
    return row;
  });
}

/** Replace the fixture character's play days with the demo plan (no-op for 0). */
export async function seedArmorySkillDays(
  db: Db,
  profileId: number,
  count: DemoSkillDayCount,
  now: Date = new Date(),
): Promise<void> {
  if (count === 0) return;
  const P = schema.valheimProfiles;
  const S = schema.pelicanServers;
  const [hit] = await db
    .select({ skills: P.skills, tz: S.timezone })
    .from(P)
    .innerJoin(S, eq(S.id, P.pelicanServerId))
    .where(eq(P.id, profileId))
    .limit(1);
  if (!hit) throw new Error(`Armory fixture profile ${profileId} not found`);
  const D = schema.valheimProfileSkillDays;
  await db.delete(D).where(eq(D.profileId, profileId));
  const tz = resolvePlayTimezone(hit.tz, null);
  await db.insert(D).values(demoSkillDayRows(profileId, hit.skills, tz, now));
}
