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

type Logger = { debug: (msg: string) => void };

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
    | Array<{ specializations?: unknown[] }>
    | undefined;
  return ((data.specializations as unknown[] | undefined) ??
    specGroups?.[0]?.specializations ??
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
        | { spell?: { name?: string; id?: number } }
        | undefined;
      const tName = talent?.name ?? spell?.spell?.name;
      if (tName)
        result.push({ name: tName, id: talent?.id ?? spell?.spell?.id });
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
      .map((t) => ({ name: t.talent!.name!, id: t.talent?.id })),
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

/** Fetch character specializations from the Blizzard API. */
export async function fetchCharacterSpecializations(
  name: string,
  realm: string,
  region: string,
  characterClass: string,
  apiNamespacePrefix: string | null,
  token: string,
  logger: Logger,
): Promise<InferredSpecialization> {
  try {
    const { realmSlug, charName, namespace, baseUrl } = buildCharacterParams(
      name,
      realm,
      region,
      apiNamespacePrefix,
    );
    const url = `${baseUrl}/profile/wow/character/${realmSlug}/${charName}/specializations?namespace=${namespace}&locale=en_US`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return NO_SPEC;
    const data = (await res.json()) as Record<string, unknown>;
    return parseSpecData(data, characterClass);
  } catch (err) {
    logger.debug(`Failed to fetch specializations: ${err}`);
    return NO_SPEC;
  }
}
