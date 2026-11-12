/**
 * ROK-1927 (P6) — the attunement smoke cast for `POST
 * /admin/test/wow/seed-attunements`, over a `seed-guild` roster:
 *
 *   - confirms the Horde Onyxia chain: one `wow_dungeon_quest_blizzard` row
 *     per quest id (what the ROK-2143 import writes once Blizzard serves the
 *     id). `onConflictDoNothing`, so a real imported row is never clobbered.
 *     Only this def is confirmed here — the others stay as the DB has them.
 *   - makes the three linked characters Orcs (Horde) and gives each an
 *     Armory completed-quest list: `done` holds the whole chain, `inProgress`
 *     its first {@link IN_PROGRESS_STEPS} quests, `notStarted` an empty list
 *     ("completed nothing", not "no data").
 *
 * Unclaimed roster rows keep no quests and take the roster's (Horde)
 * majority, so they read "No data — not claimed".
 *
 * Both halves of the body are optional (at least one is required):
 * `characters` is the Onyxia trio above; `cast` picks, per character, any
 * trackable def, its completed steps, the quest log and both capture times
 * (`demo-test-attunements-cast.helpers.ts`).
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import * as schema from '../drizzle/schema';
import {
  FOREVER_ATTUNEMENTS,
  attunementQuestSteps,
} from '../plugins/wow-common/data/forever-attunements';
import { defined } from '../common/defined.helpers';
import {
  AttunementCastEntrySchema,
  castEntryPlan,
  seedCastEntry,
  type SeededCastEntry,
} from './demo-test-attunements-cast.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** The def this fixture confirms. */
export const SEEDED_ATTUNEMENT_KEY = 'ony-horde';
/** Quests the `inProgress` character has completed. */
export const IN_PROGRESS_STEPS = 3;
/** Typed empty list (no `as` cast). */
const NONE: number[] = [];
const SEED_RACE = 'Orc';
const SEED_FACTION = 'horde';
const SEED_RUN_ID = 'demo-test-attunements';

export const SeedAttunementsSchema = z
  .object({
    characters: z
      .object({
        done: z.string().uuid(),
        inProgress: z.string().uuid(),
        notStarted: z.string().uuid(),
      })
      .strict()
      .optional(),
    cast: z.array(AttunementCastEntrySchema).min(1).max(20).optional(),
  })
  .strict()
  .refine((b) => b.characters !== undefined || b.cast !== undefined, {
    message: 'characters or cast is required',
  });

export type SeedAttunementsInput = z.infer<typeof SeedAttunementsSchema>;

export interface SeedAttunementsResult {
  key: string;
  instance: string;
  /** Confirmed quest steps, in chain order (the checklist labels). */
  steps: string[];
  inProgressSteps: number;
  /** One per `cast` entry, in body order (empty without `cast`). */
  cast: SeededCastEntry[];
}

/** Every character id the body seeds (for the cache drop). */
export function seededCharacterIds(input: SeedAttunementsInput): string[] {
  const trio = input.characters ? Object.values(input.characters) : [];
  return [...trio, ...(input.cast ?? []).map((c) => c.characterId)];
}

/** The confirmed def and the completed list each cast member gets. */
export function attunementSeedPlan() {
  const def = defined(
    FOREVER_ATTUNEMENTS.find((d) => d.key === SEEDED_ATTUNEMENT_KEY),
    `attunement ${SEEDED_ATTUNEMENT_KEY}`,
  );
  const steps = attunementQuestSteps(def);
  const ids = steps.map((s) => s.questId);
  return {
    def,
    steps,
    completed: {
      done: ids,
      inProgress: ids.slice(0, IN_PROGRESS_STEPS),
      notStarted: NONE,
    },
  };
}

async function confirmQuests(
  db: Db,
  steps: ReadonlyArray<{ questId: number; label: string }>,
  now: Date,
): Promise<void> {
  const rows = steps.map((s) => ({
    questId: s.questId,
    areaId: 0,
    dungeonInstanceId: null,
    title: s.label,
    raw: { id: s.questId, title: s.label, seededBy: SEED_RUN_ID },
    fetchedAt: now,
    runId: SEED_RUN_ID,
  }));
  await db
    .insert(schema.wowDungeonQuestBlizzard)
    .values(rows)
    .onConflictDoNothing();
}

/** Writes the Onyxia trio's race + Armory quests. */
async function seedTrio(
  db: Db,
  characters: NonNullable<SeedAttunementsInput['characters']>,
  plan: ReturnType<typeof attunementSeedPlan>,
  fetchedAt: string,
): Promise<void> {
  for (const role of ['done', 'inProgress', 'notStarted'] as const) {
    await db
      .update(schema.characters)
      .set({
        race: SEED_RACE,
        faction: SEED_FACTION,
        armoryQuests: { fetchedAt, completed: plan.completed[role] },
      })
      .where(eq(schema.characters.id, characters[role]));
  }
}

/** Confirms each def's chain, then writes the trio and/or the cast. */
export async function seedAttunements(
  db: Db,
  input: SeedAttunementsInput,
  now: Date,
): Promise<SeedAttunementsResult> {
  const plan = attunementSeedPlan();
  if (input.characters) {
    await confirmQuests(db, plan.steps, now);
    await seedTrio(db, input.characters, plan, now.toISOString());
  }
  const cast: SeededCastEntry[] = [];
  for (const entry of input.cast ?? []) {
    const entryPlan = castEntryPlan(entry, now);
    await confirmQuests(db, entryPlan.steps, now);
    cast.push(await seedCastEntry(db, entry, entryPlan));
  }
  return {
    key: plan.def.key,
    instance: plan.def.instance,
    steps: plan.steps.map((s) => s.label),
    inProgressSteps: IN_PROGRESS_STEPS,
    cast,
  };
}
