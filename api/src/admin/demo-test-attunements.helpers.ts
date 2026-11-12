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
      .strict(),
  })
  .strict();

export type SeedAttunementsInput = z.infer<typeof SeedAttunementsSchema>;

export interface SeedAttunementsResult {
  key: string;
  instance: string;
  /** Confirmed quest steps, in chain order (the checklist labels). */
  steps: string[];
  inProgressSteps: number;
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
  steps: ReturnType<typeof attunementSeedPlan>['steps'],
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

/** Confirms the chain, then writes race + Armory quests on the cast. */
export async function seedAttunements(
  db: Db,
  input: SeedAttunementsInput,
  now: Date,
): Promise<SeedAttunementsResult> {
  const plan = attunementSeedPlan();
  await confirmQuests(db, plan.steps, now);
  const fetchedAt = now.toISOString();
  for (const role of ['done', 'inProgress', 'notStarted'] as const) {
    await db
      .update(schema.characters)
      .set({
        race: SEED_RACE,
        faction: SEED_FACTION,
        armoryQuests: { fetchedAt, completed: plan.completed[role] },
      })
      .where(eq(schema.characters.id, input.characters[role]));
  }
  return {
    key: plan.def.key,
    instance: plan.def.instance,
    steps: plan.steps.map((s) => s.label),
    inProgressSteps: IN_PROGRESS_STEPS,
  };
}
