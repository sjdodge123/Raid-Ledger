/**
 * Instance and realm fetching helpers for BlizzardService.
 * Extracted from blizzard.service.ts for file size compliance (ROK-719).
 */
import type { WowGameVariant } from '@raid-ledger/contract';
import type { WowInstance, WowInstanceDetail } from './blizzard.constants';
import { getNamespacePrefixes } from './blizzard.constants';
import {
  CLASSIC_SUB_INSTANCES,
  CLASSIC_INSTANCE_LEVELS,
  getShortName,
} from './blizzard-instance-data';

type Logger = { error: (msg: string) => void; warn: (msg: string) => void };

/** Enrich an instance with short name and level overrides. */
export function enrichInstance(
  inst: WowInstance,
  gameVariant: WowGameVariant,
): WowInstance {
  const levels =
    gameVariant !== 'retail' ? CLASSIC_INSTANCE_LEVELS[inst.name] : undefined;
  return {
    ...inst,
    shortName: inst.shortName ?? getShortName(inst.name),
    minimumLevel: inst.minimumLevel ?? levels?.minimumLevel ?? null,
    maximumLevel: inst.maximumLevel ?? levels?.maximumLevel ?? null,
  };
}

/** Fetch the realm list from the Blizzard API. */
export async function fetchRealmListFromApi(
  region: string,
  gameVariant: WowGameVariant,
  token: string,
  logger: Logger,
) {
  const { dynamic: dynamicPrefix } = getNamespacePrefixes(gameVariant);
  const response = await fetch(
    `https://${region}.api.blizzard.com/data/wow/realm/index?namespace=${dynamicPrefix}-${region}&locale=en_US`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    const text = await response.text();
    logger.error(`Blizzard realm index error: ${response.status} ${text}`);
    throw new Error(`Failed to fetch realm list (${response.status})`);
  }
  const data = (await response.json()) as {
    realms: Array<{ name: string; slug: string; id: number }>;
  };
  return data.realms
    .map((r) => ({ name: r.name, slug: r.slug, id: r.id }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Fetch expansion index tiers. */
export async function fetchExpansionIndex(
  region: string,
  token: string,
): Promise<Array<{ id: number; name: string }>> {
  const res = await fetch(
    `https://${region}.api.blizzard.com/data/wow/journal-expansion/index?namespace=static-${region}&locale=en_US`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok)
    throw new Error(`Failed to fetch expansion index (${res.status})`);
  return ((await res.json()) as { tiers: Array<{ id: number; name: string }> })
    .tiers;
}

/** Fetch a single expansion's detail from the journal API. */
async function fetchSingleExpansion(
  tier: { id: number; name: string },
  baseUrl: string,
  namespace: string,
  token: string,
) {
  try {
    const res = await fetch(
      `${baseUrl}/data/wow/journal-expansion/${tier.id}?namespace=${namespace}&locale=en_US`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return null;
    const detail = (await res.json()) as {
      name?: string;
      dungeons?: Array<{ id: number; name: string }>;
      raids?: Array<{ id: number; name: string }>;
    };
    return { expansionName: detail.name ?? tier.name, detail };
  } catch {
    return null;
  }
}

/** Fetch all expansion details in parallel. */
export async function fetchExpansionDetails(
  tiers: Array<{ id: number; name: string }>,
  baseUrl: string,
  namespace: string,
  token: string,
) {
  return Promise.all(
    tiers.map((tier) => fetchSingleExpansion(tier, baseUrl, namespace, token)),
  );
}

/** Merge expansion instances into dungeons and raids arrays. */
export function mergeExpansionInstances(
  details: Array<{
    expansionName: string;
    detail: {
      dungeons?: Array<{ id: number; name: string }>;
      raids?: Array<{ id: number; name: string }>;
    };
  } | null>,
): { dungeons: WowInstance[]; raids: WowInstance[] } {
  const dungeons: WowInstance[] = [];
  const raids: WowInstance[] = [];
  for (const result of details) {
    if (!result) continue;
    for (const d of result.detail.dungeons ?? [])
      dungeons.push({
        id: d.id,
        name: d.name,
        expansion: result.expansionName,
      });
    for (const r of result.detail.raids ?? [])
      raids.push({ id: r.id, name: r.name, expansion: result.expansionName });
  }
  return { dungeons, raids };
}

/** Filter instances by game variant. */
export function filterByVariant(
  dungeons: WowInstance[],
  raids: WowInstance[],
  gameVariant: WowGameVariant,
): { dungeons: WowInstance[]; raids: WowInstance[] } {
  if (gameVariant === 'classic_era') {
    const exps = new Set(['Classic']);
    return {
      dungeons: dungeons.filter((d) => exps.has(d.expansion)),
      raids: raids.filter((r) => exps.has(r.expansion)),
    };
  }
  if (gameVariant === 'classic' || gameVariant === 'classic_anniversary') {
    const exps = new Set([
      'Classic',
      'Burning Crusade',
      'Wrath of the Lich King',
      'Cataclysm',
    ]);
    return {
      dungeons: dungeons.filter((d) => exps.has(d.expansion)),
      raids: raids.filter((r) => exps.has(r.expansion)),
    };
  }
  return { dungeons, raids };
}

/** Expand sub-instances for classic variants. */
export function expandSubInstances(instances: WowInstance[]): WowInstance[] {
  const result: WowInstance[] = [];
  for (const inst of instances) {
    const subs = CLASSIC_SUB_INSTANCES[inst.name];
    if (subs) {
      for (const sub of subs)
        result.push({
          id: inst.id * 100 + sub.idSuffix,
          name: sub.name,
          shortName: sub.shortName,
          expansion: inst.expansion,
          minimumLevel: sub.minimumLevel,
          maximumLevel: sub.maximumLevel,
        });
    } else result.push(inst);
  }
  return result;
}

/** Deduplicate instances by ID. */
export function deduplicateById(instances: WowInstance[]): WowInstance[] {
  const seen = new Set<number>();
  return instances.filter((inst) => {
    if (seen.has(inst.id)) return false;
    seen.add(inst.id);
    return true;
  });
}

/** Build instance detail from raw API data. */
export function buildInstanceDetail(
  data: {
    id: number;
    name: string;
    minimum_level?: number;
    modes?: Array<{ mode: { type: string }; players: number }>;
    category?: { type: string };
    expansion?: { name: string };
  },
  gameVariant: WowGameVariant,
): WowInstanceDetail {
  const maxPlayers = data.modes?.length
    ? Math.max(...data.modes.map((m) => m.players))
    : null;
  const category: 'dungeon' | 'raid' =
    data.category?.type?.toLowerCase() === 'raid' ? 'raid' : 'dungeon';
  const levelOverride =
    gameVariant !== 'retail' ? CLASSIC_INSTANCE_LEVELS[data.name] : undefined;
  return {
    id: data.id,
    name: data.name,
    shortName: getShortName(data.name),
    expansion: data.expansion?.name ?? 'Unknown',
    minimumLevel: levelOverride?.minimumLevel ?? data.minimum_level ?? null,
    maximumLevel: levelOverride?.maximumLevel ?? null,
    maxPlayers,
    category,
  };
}

/** Resolve a synthetic sub-instance by ID. */
export function resolveSyntheticInstance(
  instanceId: number,
): WowInstanceDetail | null {
  const suffix = instanceId % 100;
  for (const [, subs] of Object.entries(CLASSIC_SUB_INSTANCES)) {
    for (const sub of subs) {
      if (sub.idSuffix === suffix)
        return {
          id: instanceId,
          name: sub.name,
          shortName: sub.shortName,
          expansion: 'Classic',
          minimumLevel: sub.minimumLevel,
          maximumLevel: sub.maximumLevel,
          maxPlayers: 5,
          category: 'dungeon',
        };
    }
  }
  return null;
}
