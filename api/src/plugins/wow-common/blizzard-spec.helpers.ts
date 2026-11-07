/**
 * Specialization parsing helpers for BlizzardService.
 * Extracted from blizzard.service.ts for file size compliance (ROK-719).
 */
import type { InferredSpecialization } from './blizzard.constants';
import {
  buildCharacterParams,
  specToRole,
  inferClassicSpec,
} from './blizzard-character.helpers';
import { FOREVER_NAMESPACE_ALIAS } from './forever-namespace.resolver';
import { logForeverSpecKeysOnce } from './blizzard-spec-keys.log';

type Logger = { debug: (msg: string) => void; log: (msg: string) => void };

/** No-spec fallback result. */
export const NO_SPEC: InferredSpecialization = {
  spec: null,
  role: null,
  talents: null,
};

/** Extract classic talent trees from specialization API data. */
export function extractClassicTrees(data: Record<string, unknown>): Array<{
  specialization_name?: string;
  spent_points?: number;
  talents?: Array<Record<string, unknown>>;
}> {
  const specGroups = data.specialization_groups as
    Array<{ is_active?: boolean; specializations?: unknown[] }> | undefined;
  // ROK-2110 D9: prefer the active group (dual spec), else group 0.
  const group =
    specGroups?.find((g) => g?.is_active === true) ?? specGroups?.[0];
  return ((data.specializations as unknown[] | undefined) ??
    group?.specializations ??
    []) as Array<{
    specialization_name?: string;
    spent_points?: number;
    talents?: Array<Record<string, unknown>>;
  }>;
}

/** Parse specialization data from API response. */
export function parseSpecData(
  data: Record<string, unknown>,
  characterClass: string,
): InferredSpecialization {
  if ((data.active_specialization as { name: string } | undefined)?.name)
    return buildRetailSpecResult(data);
  const trees = extractClassicTrees(data);
  if (trees.length === 0) return NO_SPEC;
  return inferClassicSpec(trees, characterClass);
}

/** Extract class talent names from specialization trees. */
export function extractClassTalents(
  data: Record<string, unknown>,
): Array<{ name: string; id?: number }> {
  const result: Array<{ name: string; id?: number }> = [];
  for (const tree of (data.specializations ?? []) as Array<{
    talents?: Array<Record<string, unknown>>;
  }>) {
    for (const t of tree.talents ?? []) {
      const talent = t.talent as { name?: string; id?: number } | undefined;
      const spell = t.spell_tooltip as
        { spell?: { name?: string; id?: number } } | undefined;
      const tName = talent?.name ?? spell?.spell?.name;
      const id = talent?.id ?? spell?.spell?.id;
      if (tName)
        result.push({ name: tName, ...(id !== undefined ? { id } : {}) });
    }
  }
  return result;
}

/** Extract hero talent tree data. */
export function extractHeroTalents(data: Record<string, unknown>): {
  treeName: string | null;
  talents: Array<{ name: string; id?: number }>;
} | null {
  const heroTree = data.active_hero_talent_tree as
    | {
        hero_talent_tree?: { name?: string };
        talents?: Array<{ talent?: { name?: string; id?: number } }>;
      }
    | undefined;
  if (!heroTree) return null;
  return {
    treeName: heroTree.hero_talent_tree?.name ?? null,
    talents: (heroTree.talents ?? [])
      .filter((t) => t.talent?.name)
      .map((t) => {
        const id = t.talent?.id;
        return { name: t.talent!.name!, ...(id !== undefined ? { id } : {}) };
      }),
  };
}

/** Build retail spec result with talent loadout data. */
export function buildRetailSpecResult(
  data: Record<string, unknown>,
): InferredSpecialization {
  const specName = (data.active_specialization as { name: string }).name;
  const classTalents = extractClassTalents(data);
  const heroTalents = extractHeroTalents(data);
  return {
    spec: specName,
    role: specToRole(specName),
    talents: { format: 'retail', specName, classTalents, heroTalents },
  };
}

/** ROK-2110 D8: keys-only log of the Forever response shape, once. */
function noteForeverSpecKeys(
  data: Record<string, unknown>,
  apiNamespacePrefix: string | null,
  logger: Logger,
): void {
  if (apiNamespacePrefix === FOREVER_NAMESPACE_ALIAS) {
    logForeverSpecKeysOnce(data, logger);
  }
}

/** Fetch character specializations from the Blizzard API. */
export async function fetchCharacterSpecializations(
  name: string,
  realm: string | null,
  region: string,
  characterClass: string,
  apiNamespacePrefix: string | null,
  token: string,
  logger: Logger,
): Promise<InferredSpecialization> {
  try {
    const { characterPath, namespace, baseUrl } = buildCharacterParams(
      name,
      realm,
      region,
      apiNamespacePrefix,
    );
    const url = `${baseUrl}/profile/wow/character/${characterPath}/specializations?namespace=${namespace}&locale=en_US`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return NO_SPEC;
    const data = (await res.json()) as Record<string, unknown>;
    noteForeverSpecKeys(data, apiNamespacePrefix, logger);
    return parseSpecData(data, characterClass);
  } catch (err) {
    logger.debug(`Failed to fetch specializations: ${err}`);
    return NO_SPEC;
  }
}
