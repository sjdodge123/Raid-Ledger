/**
 * High-level instance API orchestration helpers for BlizzardService.
 * Composes the lower-level helpers in blizzard-instance.helpers.ts.
 */
import type { WowGameVariant } from '@raid-ledger/contract';
import type {
  InstanceListCacheData,
  WowInstanceDetail,
} from './blizzard.constants';
import * as instH from './blizzard-instance.helpers';

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
  let { dungeons, raids } = instH.mergeExpansionInstances(details);
  ({ dungeons, raids } = instH.filterByVariant(dungeons, raids, gameVariant));
  dungeons = instH.deduplicateById(dungeons);
  raids = instH.deduplicateById(raids);
  if (gameVariant !== 'retail') {
    dungeons = instH.expandSubInstances(dungeons);
    raids = instH.expandSubInstances(raids);
  }
  return {
    dungeons: dungeons.map((i) => instH.enrichInstance(i, gameVariant)),
    raids: raids.map((i) => instH.enrichInstance(i, gameVariant)),
  };
}

export async function fetchInstanceDetailFromApi(
  instanceId: number,
  region: string,
  gameVariant: WowGameVariant,
  token: string,
): Promise<WowInstanceDetail> {
  if (instanceId > 10000) {
    const synth = instH.resolveSyntheticInstance(instanceId);
    if (synth) return synth;
  }
  const url = `https://${region}.api.blizzard.com/data/wow/journal-instance/${instanceId}?namespace=static-${region}&locale=en_US`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok)
    throw new Error(`Failed to fetch instance detail (${res.status})`);
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
