/**
 * High-level instance API orchestration helpers for BlizzardService.
 * Composes the lower-level helpers in blizzard-instance.helpers.ts.
 */
import { HttpException, NotFoundException } from '@nestjs/common';
import type { WowGameVariant } from '@raid-ledger/contract';
import type {
  InstanceListCacheData,
  WowInstanceDetail,
} from './blizzard.constants';
import * as instH from './blizzard-instance.helpers';
import { blizzardUpstreamError } from './blizzard-upstream-error';
import {
  findForeverSeedInstance,
  mergeForeverSeed,
} from './forever-instance-data';

type ExpansionDetails = Awaited<ReturnType<typeof instH.fetchExpansionDetails>>;

/**
 * ROK-1719: a failed journal-expansion call is dropped as null. For Forever
 * that would cache a seed-only (no vanilla) list for 24h, so a missing
 * Classic tier throws instead — BlizzardService serves the seed uncached.
 * Forever only: other variants keep their existing partial-list behaviour.
 */
function assertForeverHasClassic(details: ExpansionDetails): void {
  if (details.some((d) => d?.expansionName === 'Classic')) return;
  throw blizzardUpstreamError(
    502,
    'instances',
    'WoW: Forever instance list is missing the Classic journal tier. Please try again later.',
  );
}

export async function fetchAllInstancesFromApi(
  region: string,
  gameVariant: WowGameVariant,
  token: string,
): Promise<InstanceListCacheData> {
  const tiers = await instH.fetchExpansionIndex(region, token);
  const details = await instH.fetchExpansionDetails(
    tiers,
    `https://${region}.api.blizzard.com`,
    `static-${region}`,
    token,
  );
  if (gameVariant === 'wow_forever') assertForeverHasClassic(details);
  let { dungeons, raids } = instH.mergeExpansionInstances(details);
  ({ dungeons, raids } = instH.filterByVariant(dungeons, raids, gameVariant));
  dungeons = instH.deduplicateById(dungeons);
  raids = instH.deduplicateById(raids);
  if (gameVariant !== 'retail') {
    dungeons = instH.expandSubInstances(dungeons);
    raids = instH.expandSubInstances(raids);
  }
  if (gameVariant === 'wow_forever') {
    // ROK-1719: seeded Forever instances carry explicit levels, so
    // enrichInstance never applies the name-keyed (TBC) Hyjal Summit 70.
    dungeons = mergeForeverSeed(dungeons, 'dungeon');
    raids = mergeForeverSeed(raids, 'raid');
  }
  return {
    dungeons: dungeons.map((i) => instH.enrichInstance(i, gameVariant)),
    raids: raids.map((i) => instH.enrichInstance(i, gameVariant)),
  };
}

/** A failed journal-instance call: an unknown id is a 404, the rest a 502. */
function instanceDetailError(
  status: number,
  instanceId: number,
): HttpException {
  if (status === 404)
    return new NotFoundException(`Instance ${instanceId} not found`);
  return blizzardUpstreamError(
    status,
    'instances',
    `Failed to fetch instance detail from Blizzard (${status}). Please try again later.`,
  );
}

export async function fetchInstanceDetailFromApi(
  instanceId: number,
  region: string,
  gameVariant: WowGameVariant,
  token: string,
): Promise<WowInstanceDetail> {
  // ROK-1719: before the synthetic branch — 90_000_001 % 100 would otherwise
  // resolve to a Scarlet Monastery wing. Variant-independent on purpose: a
  // saved event's id must resolve whatever the viewer's variant mapping.
  const seeded = findForeverSeedInstance(instanceId);
  if (seeded) return seeded;
  if (instanceId > 10000) {
    const synth = instH.resolveSyntheticInstance(instanceId);
    if (synth) return synth;
  }
  const url = `https://${region}.api.blizzard.com/data/wow/journal-instance/${instanceId}?namespace=static-${region}&locale=en_US`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw instanceDetailError(res.status, instanceId);
  const data = (await res.json()) as {
    id: number;
    name: string;
    minimum_level?: number;
    modes?: Array<{ mode: { type: string }; players: number }>;
    category?: { type: string };
    expansion?: { name: string };
  };
  return instH.buildInstanceDetail(data, gameVariant);
}
