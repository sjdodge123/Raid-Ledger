/**
 * Blizzard character API helper functions.
 * Extracted from BlizzardService for file size compliance (ROK-711).
 */
import { Logger } from '@nestjs/common';
import type { WowGameVariant } from '@raid-ledger/contract';
import {
  type BlizzardEquipmentItem,
  type BlizzardCharacterEquipment,
  getNamespacePrefixes,
  SPEC_ROLE_MAP,
  CLASSIC_TALENT_TREE_ROLES,
} from './blizzard.constants';

const logger = new Logger('BlizzardCharacterHelpers');

/** Map a WoW spec name to a role. */
export function specToRole(spec: string): 'tank' | 'healer' | 'dps' | null {
  return SPEC_ROLE_MAP[spec] ?? null;
}

/** Build API base params for character endpoints. */
export function buildCharacterParams(
  name: string,
  realm: string,
  region: string,
  gameVariant: WowGameVariant,
): { realmSlug: string; charName: string; namespace: string; baseUrl: string } {
  const realmSlug = realm
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/\s+/g, '-')
    .trim();
  const charName = name.toLowerCase();
  const { profile: profilePrefix } = getNamespacePrefixes(gameVariant);
  const namespace = `${profilePrefix}-${region}`;
  const baseUrl = `https://${region}.api.blizzard.com`;
  return { realmSlug, charName, namespace, baseUrl };
}

/** Fetch character media (avatar + render URL). Non-fatal on failure. */
export async function fetchCharacterMedia(
  profileUrl: string,
  namespace: string,
  token: string,
): Promise<{ avatarUrl: string | null; renderUrl: string | null }> {
  let avatarUrl: string | null = null;
  let renderUrl: string | null = null;
  try {
    const mediaRes = await fetch(
      `${profileUrl}/character-media?namespace=${namespace}&locale=en_US`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (mediaRes.ok) {
      const media = (await mediaRes.json()) as {
        assets?: Array<{ key: string; value: string }>;
      };
      const avatar = media.assets?.find(
        (a) => a.key === 'avatar' || a.key === 'inset',
      );
      avatarUrl = avatar?.value ?? null;
      const mainRaw =
        media.assets?.find((a) => a.key === 'main-raw') ??
        media.assets?.find((a) => a.key === 'main');
      renderUrl = mainRaw?.value ?? null;
    }
  } catch (err) {
    logger.warn(`Failed to fetch character media: ${err}`);
  }
  return { avatarUrl, renderUrl };
}

/** Map raw equipment items from Blizzard API response. */
export function mapEquipmentItems(
  rawItems: Array<Record<string, unknown>>,
  iconUrls: Map<number, string>,
): BlizzardEquipmentItem[] {
  return rawItems.map((item: Record<string, unknown>) => {
    const slot = item.slot as { type: string };
    const itemObj = item.item as { id: number };
    const quality = item.quality as { type: string } | undefined;
    const level = item.level as { value: number } | undefined;
    const itemSubclass = item.item_subclass as { name: string } | undefined;
    const enchantments = item.enchantments as
      | Array<{ display_string: string; enchantment_id?: number }>
      | undefined;
    const sockets = item.sockets as
      | Array<{ socket_type: { type: string }; item?: { id: number } }>
      | undefined;
    const stats = item.stats as
      | Array<{ type: { type: string; name: string }; value: number }>
      | undefined;
    const armor = item.armor as { value: number } | undefined;
    const binding = item.binding as { type: string } | undefined;
    const requirements = item.requirements as
      | { level?: { value: number } }
      | undefined;
    const weapon = item.weapon as
      | {
          damage: { min_value: number; max_value: number };
          attack_speed: { value: number };
          dps: { value: number };
        }
      | undefined;
    const setObj = item.set as { item_set?: { name: string } } | undefined;

    return {
      slot: slot.type,
      name: (item.name as string) ?? 'Unknown',
      itemId: itemObj.id,
      quality: (quality?.type ?? 'COMMON').toUpperCase(),
      itemLevel: level?.value ?? 0,
      itemSubclass: itemSubclass?.name ?? null,
      enchantments: enchantments?.map((e) => ({
        displayString: e.display_string,
        enchantmentId: e.enchantment_id,
      })),
      sockets: sockets?.map((s) => ({
        socketType: s.socket_type?.type ?? 'UNKNOWN',
        itemId: s.item?.id,
      })),
      stats: stats?.map((s) => ({
        type: s.type.type,
        name: s.type.name,
        value: s.value,
      })),
      armor: armor?.value,
      binding: binding?.type,
      requiredLevel: requirements?.level?.value,
      weapon: weapon
        ? {
            damageMin: weapon.damage.min_value,
            damageMax: weapon.damage.max_value,
            attackSpeed: weapon.attack_speed.value,
            dps: weapon.dps.value,
          }
        : undefined,
      description: item.description as string | undefined,
      setName: setObj?.item_set?.name,
      iconUrl: iconUrls.get(itemObj.id),
    };
  });
}

/** Build equipment result from raw API data and icon URLs. */
export function buildEquipmentResult(
  data: {
    equipped_item_level?: number;
    equipped_items?: Array<Record<string, unknown>>;
  },
  iconUrls: Map<number, string>,
): BlizzardCharacterEquipment {
  const rawItems = (data.equipped_items ?? []).filter(
    (item: Record<string, unknown>) => {
      const slot = item.slot as { type: string } | undefined;
      const itemObj = item.item as { id: number } | undefined;
      return slot?.type && itemObj?.id;
    },
  );
  return {
    equippedItemLevel: data.equipped_item_level ?? null,
    items: mapEquipmentItems(rawItems, iconUrls),
    syncedAt: new Date().toISOString(),
  };
}

/** Infer classic spec from talent trees. */
export function inferClassicSpec(
  trees: Array<{
    specialization_name?: string;
    spent_points?: number;
    talents?: Array<Record<string, unknown>>;
  }>,
  characterClass: string,
): {
  spec: string | null;
  role: 'tank' | 'healer' | 'dps' | null;
  talents: unknown;
} {
  const classicTalents = buildClassicTalentData(trees);

  let bestTree: { name: string; points: number } | null = null;
  for (const tree of trees) {
    const treeName = tree.specialization_name;
    const points = tree.spent_points ?? tree.talents?.length ?? 0;
    if (treeName && (!bestTree || points > bestTree.points)) {
      bestTree = { name: treeName, points };
    }
  }

  if (!bestTree || bestTree.points === 0) {
    return {
      spec: null,
      role: null,
      talents: classicTalents.trees.length > 0 ? classicTalents : null,
    };
  }

  const classRoles = CLASSIC_TALENT_TREE_ROLES[characterClass];
  const role = classRoles?.[bestTree.name] ?? specToRole(bestTree.name);

  return { spec: bestTree.name, role, talents: classicTalents };
}

/** Build classic talent data structure from talent trees. */
function buildClassicTalentData(
  trees: Array<{
    specialization_name?: string;
    spent_points?: number;
    talents?: Array<Record<string, unknown>>;
  }>,
): {
  format: 'classic';
  trees: Array<{
    name: string;
    spentPoints: number;
    talents: Array<Record<string, unknown>>;
  }>;
  summary: string;
} {
  const result = {
    format: 'classic' as const,
    trees: [] as Array<{
      name: string;
      spentPoints: number;
      talents: Array<Record<string, unknown>>;
    }>,
    summary: '',
  };

  for (const tree of trees) {
    const treeName = tree.specialization_name;
    const points = tree.spent_points ?? tree.talents?.length ?? 0;
    if (treeName) {
      result.trees.push({
        name: treeName,
        spentPoints: points,
        talents: (tree.talents ?? [])
          .filter((t: Record<string, unknown>) => {
            const talent = t.talent as { name?: string } | undefined;
            const spell = t.spell_tooltip as
              | { spell?: { name?: string } }
              | undefined;
            return talent?.name || spell?.spell?.name;
          })
          .map((t: Record<string, unknown>) => {
            const talent = t.talent as
              | { name?: string; id?: number }
              | undefined;
            const spell = t.spell_tooltip as
              | { spell?: { name?: string; id?: number } }
              | undefined;
            return {
              name: talent?.name ?? spell?.spell?.name ?? 'Unknown',
              id: talent?.id,
              spellId: spell?.spell?.id,
              rank: t.talent_rank,
              tierIndex: t.tier_index,
              columnIndex: t.column_index,
            };
          }),
      });
    }
  }

  result.summary = result.trees.map((t) => t.spentPoints).join('/');
  return result;
}
