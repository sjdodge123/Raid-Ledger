/**
 * ROK-1927 — the per-character `cast` of `POST
 * /admin/test/wow/seed-attunements`, so a test plan can seed every attunement
 * state. Each entry names a character, the attunement def, how many of its
 * quest steps the Armory completed list holds, and optionally the quest ids
 * in the LedgerLink quest log with that log's capture time:
 *
 *   { characterId, attunement: 'mc-horde', completedSteps: 2,
 *     questLog: [<next quest id>], questLogCapturedAt: '<older ISO>',
 *     completedAt: '<newer ISO>', level: 60 }
 *
 * - The def's quest steps are confirmed like the Onyxia chain (an attunement
 *   shows only when its final quest is confirmed).
 * - Race + faction follow the def (`both` → `faction`, default horde).
 * - `questLog` upserts the `char` snapshot's `quests` slice as a log-only
 *   export (no `completed`: the Armory list stays the completed list), keeping
 *   any gear/lockouts already stored. Without `questLog` the snapshot is left
 *   as it is.
 */
import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import {
  ADDON_CHAR_SNAPSHOT_SCHEMA,
  ADDON_QUESTS_IN_PROGRESS_MAX,
  type AddonCharSnapshotData,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import {
  FOREVER_ATTUNEMENTS,
  attunementQuestSteps,
  type AttunementDef,
} from '../plugins/wow-common/data/forever-attunements';
import { defined } from '../common/defined.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Defs a cast entry may pick: the trackable ones. */
export const CAST_ATTUNEMENT_KEYS = FOREVER_ATTUNEMENTS.filter(
  (d) => d.trackable,
).map((d) => d.key);

const RACE_OF = { horde: 'Orc', alliance: 'Human' } as const;

export const AttunementCastEntrySchema = z
  .object({
    characterId: z.string().uuid(),
    attunement: z
      .string()
      .refine((k) => CAST_ATTUNEMENT_KEYS.includes(k), 'unknown attunement'),
    completedSteps: z.number().int().min(0).max(50),
    questLog: z
      .array(z.number().int().positive())
      .max(ADDON_QUESTS_IN_PROGRESS_MAX)
      .optional(),
    questLogCapturedAt: z.string().datetime().optional(),
    completedAt: z.string().datetime().optional(),
    faction: z.enum(['horde', 'alliance']).optional(),
    level: z.number().int().min(1).max(60).optional(),
  })
  .strict();

export type AttunementCastEntry = z.infer<typeof AttunementCastEntrySchema>;

export interface SeededCastEntry {
  characterId: string;
  key: string;
  instance: string;
  /** Confirmed quest steps, in chain order. */
  steps: string[];
  completedSteps: number;
}

function castDef(key: string): AttunementDef {
  return defined(
    FOREVER_ATTUNEMENTS.find((d) => d.key === key),
    `attunement ${key}`,
  );
}

/** The writes one cast entry implies (pure, unit-tested). */
export function castEntryPlan(entry: AttunementCastEntry, now: Date) {
  const def = castDef(entry.attunement);
  const steps = attunementQuestSteps(def);
  const completed = steps.slice(0, entry.completedSteps).map((s) => s.questId);
  const side =
    def.faction === 'both' ? (entry.faction ?? 'horde') : def.faction;
  const log = entry.questLog;
  return {
    def,
    steps,
    race: RACE_OF[side],
    faction: side,
    armoryQuests: {
      fetchedAt: entry.completedAt ?? now.toISOString(),
      completed,
    },
    questLog: log
      ? {
          inProgress: log.map((questId) => ({ questId })),
          capturedAt: new Date(entry.questLogCapturedAt ?? now.toISOString()),
        }
      : null,
  };
}

type CastPlan = ReturnType<typeof castEntryPlan>;

/** Upsert the `char` snapshot's `quests` slice, keeping gear/lockouts. */
async function upsertQuestLog(
  db: Db,
  characterId: string,
  log: NonNullable<CastPlan['questLog']>,
): Promise<void> {
  const quests = { inProgress: log.inProgress };
  const data: AddonCharSnapshotData = {
    gear: [],
    talents: { nodes: [] },
    lockouts: [],
    quests,
  };
  const snap = schema.characterAddonSnapshots;
  const row = {
    capturedAt: log.capturedAt,
    completedCapturedAt: null,
    importedAt: log.capturedAt,
    payloadSha256: createHash('sha256')
      .update(JSON.stringify(data))
      .digest('hex'),
  };
  await db
    .insert(snap)
    .values({
      characterId,
      section: 'char',
      schema: ADDON_CHAR_SNAPSHOT_SCHEMA,
      data,
      ...row,
    })
    .onConflictDoUpdate({
      target: [snap.characterId, snap.section],
      set: {
        ...row,
        data: sql`jsonb_set(${snap.data}, '{quests}', ${JSON.stringify(quests)}::jsonb)`,
      },
    });
}

/** Writes race/faction/level + Armory list (+ quest log) for one entry. */
export async function seedCastEntry(
  db: Db,
  entry: AttunementCastEntry,
  plan: CastPlan,
): Promise<SeededCastEntry> {
  await db
    .update(schema.characters)
    .set({
      race: plan.race,
      faction: plan.faction,
      armoryQuests: plan.armoryQuests,
      ...(entry.level === undefined ? {} : { level: entry.level }),
    })
    .where(eq(schema.characters.id, entry.characterId));
  if (plan.questLog) await upsertQuestLog(db, entry.characterId, plan.questLog);
  return {
    characterId: entry.characterId,
    key: plan.def.key,
    instance: plan.def.instance,
    steps: plan.steps.map((s) => s.label),
    completedSteps: plan.armoryQuests.completed.length,
  };
}
