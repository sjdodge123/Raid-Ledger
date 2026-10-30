/**
 * ROK-1917 — the optional `withPulls: true` half of the DEMO_MODE
 * `POST /admin/test/wow/seed-guild` fixture: LedgerLink raid-export boss
 * pulls in the guild's scope, for the "Raid progress" hub widget:
 *   - Lucifron: a wipe, then a kill (gm) — plus the SAME kill exported 3 s
 *     later by the officer, which the 10 s near-dup window collapses;
 *   - Magmadar: two wipes (gm, officer) — never killed;
 *   - Ragnaros: a kill reported by the outsider (no linked character), which
 *     the Q1 trust filter drops — it must never show.
 *
 * Re-seeding deletes the guild's pulls first, so a re-call never doubles them.
 */
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { SEED_GUILD_REGION } from './demo-test-guild.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type PullInsert = schema.AddonEncounterPullInsert;

/** The seed users that "export" the pulls. */
export interface SeedPullReporters {
  gm: number;
  officer: number;
  outsider: number;
}

export interface SeedPullsInput {
  gameId: number;
  /** The seed guild's `name_key` (lower-cased name) = the pulls' guild_key. */
  guildKey: string;
  reporters: SeedPullReporters;
  now: Date;
}

/** What the `withPulls` seed wrote — what the widget should show. */
export interface SeededGuildPulls {
  killed: { name: string; kills: number; wipes: number };
  unkilled: { name: string; wipes: number };
  /** Reported by a non-member — dropped by the trust filter. */
  untrusted: string;
  killedCount: number;
  /** After the near-dup collapse and the trust filter. */
  pullCount: number;
}

const MIN = 60_000;
const DIFFICULTY_40 = 9;

interface PullSpec {
  encounterId: number;
  name: string;
  offsetMs: number;
  success: boolean;
  by: keyof SeedPullReporters;
}

const PULLS: readonly PullSpec[] = [
  { encounterId: 663, name: 'Lucifron', offsetMs: 0, success: false, by: 'gm' },
  {
    encounterId: 663,
    name: 'Lucifron',
    offsetMs: 10 * MIN,
    success: true,
    by: 'gm',
  },
  {
    encounterId: 663,
    name: 'Lucifron',
    offsetMs: 10 * MIN + 3_000,
    success: true,
    by: 'officer',
  },
  {
    encounterId: 664,
    name: 'Magmadar',
    offsetMs: 20 * MIN,
    success: false,
    by: 'gm',
  },
  {
    encounterId: 664,
    name: 'Magmadar',
    offsetMs: 25 * MIN,
    success: false,
    by: 'officer',
  },
  {
    encounterId: 672,
    name: 'Ragnaros',
    offsetMs: 40 * MIN,
    success: true,
    by: 'outsider',
  },
];

/** The seeded pulls' expected raid progress, for the response. */
export const SEEDED_GUILD_PULLS: SeededGuildPulls = {
  killed: { name: 'Lucifron', kills: 1, wipes: 1 },
  unkilled: { name: 'Magmadar', wipes: 2 },
  untrusted: 'Ragnaros',
  killedCount: 1,
  pullCount: 4,
};

/** The pull rows, starting two days before `now` (pure). */
export function seedPullRows(input: SeedPullsInput): PullInsert[] {
  const anchor = input.now.getTime() - 2 * 24 * 60 * MIN;
  return PULLS.map((p, i) => {
    const startAt = new Date(anchor + p.offsetMs);
    return {
      gameId: input.gameId,
      region: SEED_GUILD_REGION,
      encounterId: p.encounterId,
      encounterName: p.name,
      difficultyId: DIFFICULTY_40,
      groupSize: 40,
      startAt,
      endAt: new Date(startAt.getTime() + 3 * MIN),
      success: p.success,
      roster: [],
      guildKey: input.guildKey,
      reportedByUserId: input.reporters[p.by],
      payloadSha256: createHash('sha256')
        .update(`seed-pull:${input.guildKey}:${i}`)
        .digest('hex'),
    };
  });
}

/** Replace the guild's pulls with the seeded set. */
export async function seedGuildPulls(
  db: Db,
  input: SeedPullsInput,
): Promise<SeededGuildPulls> {
  const p = schema.addonEncounterPulls;
  await db
    .delete(p)
    .where(
      and(
        eq(p.gameId, input.gameId),
        eq(p.region, SEED_GUILD_REGION),
        eq(p.guildKey, input.guildKey),
      ),
    );
  await db.insert(p).values(seedPullRows(input)).onConflictDoNothing();
  return SEEDED_GUILD_PULLS;
}
