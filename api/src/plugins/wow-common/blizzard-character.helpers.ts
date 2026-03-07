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

type EnchantmentEntry = { display_string: string; enchantment_id?: number };
type SocketEntry = { socket_type: { type: string }; item?: { id: number } };
type StatEntry = { type: { type: string; name: string }; value: number };
type WeaponData = {
  damage: { min_value: number; max_value: number };
  attack_speed: { value: number };
  dps: { value: number };
};

/** Extract typed fields from a raw equipment item. */
function extractItemFields(item: Record<string, unknown>) {
  return {
    slot: item.slot as { type: string },
    itemObj: item.item as { id: number },
    quality: item.quality as { type: string } | undefined,
    level: item.level as { value: number } | undefined,
    itemSubclass: item.item_subclass as { name: string } | undefined,
    enchantments: item.enchantments as EnchantmentEntry[] | undefined,
    sockets: item.sockets as SocketEntry[] | undefined,
    stats: item.stats as StatEntry[] | undefined,
    armor: item.armor as { value: number } | undefined,
    binding: item.binding as { type: string } | undefined,
    requirements: item.requirements as
      | { level?: { value: number } }
      | undefined,
    weapon: item.weapon as WeaponData | undefined,
    setObj: item.set as { item_set?: { name: string } } | undefined,
  };
}

/** Map weapon data to the output format. */
function mapWeapon(w: WeaponData | undefined) {
  return w
    ? {
        damageMin: w.damage.min_value,
        damageMax: w.damage.max_value,
        attackSpeed: w.attack_speed.value,
        dps: w.dps.value,
      }
    : undefined;
}

/** Map a single raw equipment item to a BlizzardEquipmentItem. */
function mapSingleItem(
  item: Record<string, unknown>,
  iconUrls: Map<number, string>,
): BlizzardEquipmentItem {
  const f = extractItemFields(item);
  return {
    slot: f.slot.type,
    name: (item.name as string) ?? 'Unknown',
    itemId: f.itemObj.id,
    quality: (f.quality?.type ?? 'COMMON').toUpperCase(),
    itemLevel: f.level?.value ?? 0,
    itemSubclass: f.itemSubclass?.name ?? null,
    enchantments: f.enchantments?.map((e) => ({
      displayString: e.display_string,
      enchantmentId: e.enchantment_id,
    })),
    sockets: f.sockets?.map((s) => ({
      socketType: s.socket_type?.type ?? 'UNKNOWN',
      itemId: s.item?.id,
    })),
    stats: f.stats?.map((s) => ({
      type: s.type.type,
      name: s.type.name,
      value: s.value,
    })),
    armor: f.armor?.value,
    binding: f.binding?.type,
    requiredLevel: f.requirements?.level?.value,
    weapon: mapWeapon(f.weapon),
    description: item.description as string | undefined,
    setName: f.setObj?.item_set?.name,
    iconUrl: iconUrls.get(f.itemObj.id),
  };
}

/** Map raw equipment items from Blizzard API response. */
export function mapEquipmentItems(
  rawItems: Array<Record<string, unknown>>,
  iconUrls: Map<number, string>,
): BlizzardEquipmentItem[] {
  return rawItems.map((item) => mapSingleItem(item, iconUrls));
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

type TalentTreeInput = Array<{
  specialization_name?: string;
  spent_points?: number;
  talents?: Array<Record<string, unknown>>;
}>;

/** Find the tree with the most spent points. */
function findBestTree(
  trees: TalentTreeInput,
): { name: string; points: number } | null {
  let best: { name: string; points: number } | null = null;
  for (const tree of trees) {
    const treeName = tree.specialization_name;
    const points = tree.spent_points ?? tree.talents?.length ?? 0;
    if (treeName && (!best || points > best.points))
      best = { name: treeName, points };
  }
  return best;
}

/** Infer classic spec from talent trees. */
export function inferClassicSpec(
  trees: TalentTreeInput,
  characterClass: string,
): {
  spec: string | null;
  role: 'tank' | 'healer' | 'dps' | null;
  talents: unknown;
} {
  const classicTalents = buildClassicTalentData(trees);
  const bestTree = findBestTree(trees);
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

type ClassicTalentTree = {
  name: string;
  spentPoints: number;
  talents: Array<Record<string, unknown>>;
};
type ClassicTalentResult = {
  format: 'classic';
  trees: ClassicTalentTree[];
  summary: string;
};

/** Map raw talents to cleaned talent objects. */
function mapClassicTalents(
  rawTalents: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return rawTalents
    .filter((t) => {
      const talent = t.talent as { name?: string } | undefined;
      const spell = t.spell_tooltip as
        | { spell?: { name?: string } }
        | undefined;
      return talent?.name || spell?.spell?.name;
    })
    .map((t) => {
      const talent = t.talent as { name?: string; id?: number } | undefined;
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
    });
}

/** Build classic talent data structure from talent trees. */
function buildClassicTalentData(
  trees: Array<{
    specialization_name?: string;
    spent_points?: number;
    talents?: Array<Record<string, unknown>>;
  }>,
): ClassicTalentResult {
  const resultTrees: ClassicTalentTree[] = [];
  for (const tree of trees) {
    const treeName = tree.specialization_name;
    const points = tree.spent_points ?? tree.talents?.length ?? 0;
    if (treeName) {
      resultTrees.push({
        name: treeName,
        spentPoints: points,
        talents: mapClassicTalents(tree.talents ?? []),
      });
    }
  }
  return {
    format: 'classic',
    trees: resultTrees,
    summary: resultTrees.map((t) => t.spentPoints).join('/'),
  };
}
