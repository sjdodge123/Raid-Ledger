import { and, eq, inArray } from 'drizzle-orm';
import type {
  AddonPull,
  AddonRaidExport,
  AddonRaidImportSummarySchema,
} from '@raid-ledger/contract';
import type { z } from 'zod';
import {
  addonEncounterPulls,
  type AddonEncounterPullInsert,
  type AddonPullRosterEntry,
} from '../../../drizzle/schema';
import {
  fromUnix,
  guildNameKey,
  type AddonApplyContext,
  type AddonSectionOutcome,
} from './addon-import-apply.types';

/**
 * ROK-1724 §4.3 Apply — section `raid`. Pulls are shared, self-reported rows
 * deduplicated on (game, region, encounter, start_at, guild_key) with
 * `ON CONFLICT DO NOTHING`. No event matching, no attendance writes.
 */

export type AddonRaidSummary = z.infer<typeof AddonRaidImportSummarySchema>;
type RaidOutcome = AddonSectionOutcome<AddonRaidSummary>;

export function buildRaidSummary(
  pulls: AddonPull[],
  newPulls: number,
): AddonRaidSummary {
  const kills = pulls.filter((p) => p.success).length;
  return {
    pulls: pulls.length,
    newPulls,
    duplicatePulls: pulls.length - newPulls,
    kills,
    wipes: pulls.length - kills,
  };
}

/** GUIDs zipped with the names the addon saw ('' when a name is missing). */
export function rosterEntries(pull: AddonPull): AddonPullRosterEntry[] {
  return pull.roster.map((guid, i) => ({
    guid,
    name: pull.rosterNames[i] ?? '',
  }));
}

export function pullRow(
  pull: AddonPull,
  payload: AddonRaidExport,
  ctx: AddonApplyContext,
): AddonEncounterPullInsert {
  return {
    gameId: ctx.gameId,
    region: ctx.region,
    encounterId: pull.encounterId,
    encounterName: pull.name,
    difficultyId: pull.difficultyId,
    groupSize: pull.groupSize,
    instanceId: pull.instanceId ?? null,
    startAt: fromUnix(pull.startAt),
    endAt: fromUnix(pull.endAt),
    success: pull.success,
    roster: rosterEntries(pull),
    guildKey: guildNameKey(payload.who.guildName),
    reportedByUserId: ctx.userId,
    reportedByCharacterId: ctx.characterId,
    payloadSha256: ctx.sha256,
  };
}

export const pullKey = (encounterId: number, startAtMs: number) =>
  `${encounterId}:${startAtMs}`;

/** Pulls that would insert: not stored yet and first of their key in the payload. */
export function countNewPulls(
  pulls: AddonPull[],
  storedKeys: Set<string>,
): number {
  const seen = new Set(storedKeys);
  let fresh = 0;
  for (const p of pulls) {
    const key = pullKey(p.encounterId, p.startAt * 1000);
    if (!seen.has(key)) fresh += 1;
    seen.add(key);
  }
  return fresh;
}

async function countNew(
  ctx: AddonApplyContext,
  payload: AddonRaidExport,
): Promise<number> {
  const pulls = payload.data.pulls;
  if (pulls.length === 0) return 0;
  const stored = await ctx.tx
    .select({
      e: addonEncounterPulls.encounterId,
      s: addonEncounterPulls.startAt,
    })
    .from(addonEncounterPulls)
    .where(
      and(
        eq(addonEncounterPulls.gameId, ctx.gameId),
        eq(addonEncounterPulls.region, ctx.region),
        eq(addonEncounterPulls.guildKey, guildNameKey(payload.who.guildName)),
        inArray(
          addonEncounterPulls.encounterId,
          pulls.map((p) => p.encounterId),
        ),
      ),
    );
  const storedKeys = stored.map((r) => pullKey(r.e, r.s.getTime()));
  return countNewPulls(pulls, new Set(storedKeys));
}

/** Dry run: how many pulls would be new vs already reported. No writes. */
export async function previewRaid(
  ctx: AddonApplyContext,
  payload: AddonRaidExport,
): Promise<RaidOutcome> {
  const fresh = await countNew(ctx, payload);
  return {
    status: 'preview',
    summary: buildRaidSummary(payload.data.pulls, fresh),
  };
}

/** Insert every pull, skipping ones already reported (by anyone). */
export async function applyRaid(
  ctx: AddonApplyContext,
  payload: AddonRaidExport,
): Promise<RaidOutcome> {
  const pulls = payload.data.pulls;
  if (pulls.length === 0) {
    return { status: 'applied', summary: buildRaidSummary(pulls, 0) };
  }
  const inserted = await ctx.tx
    .insert(addonEncounterPulls)
    .values(pulls.map((p) => pullRow(p, payload, ctx)))
    .onConflictDoNothing({
      target: [
        addonEncounterPulls.gameId,
        addonEncounterPulls.region,
        addonEncounterPulls.encounterId,
        addonEncounterPulls.startAt,
        addonEncounterPulls.guildKey,
      ],
    })
    .returning({ id: addonEncounterPulls.id });
  return {
    status: 'applied',
    summary: buildRaidSummary(pulls, inserted.length),
  };
}
