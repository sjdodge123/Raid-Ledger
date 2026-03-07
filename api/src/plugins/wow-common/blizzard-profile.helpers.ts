/**
 * Character profile fetching helpers for BlizzardService.
 * Extracted from blizzard.service.ts for file size compliance (ROK-719).
 */
import { NotFoundException } from '@nestjs/common';
import type { WowGameVariant } from '@raid-ledger/contract';
import type { BlizzardCharacterProfile } from './blizzard.constants';
import {
  buildCharacterParams,
  fetchCharacterMedia,
  specToRole,
} from './blizzard-character.helpers';

type Logger = {
  error: (msg: string) => void;
  warn: (msg: string) => void;
};

/** Raw profile shape from the Blizzard character API. */
export interface RawBlizzardProfile {
  name: string;
  level: number;
  character_class: { name: string };
  active_spec?: { name: string };
  race: { name: string };
  faction: { type: string };
  realm: { name: string };
}

/** Throw appropriate error for failed profile fetch. */
export function throwProfileError(
  status: number,
  text: string,
  name: string,
  realm: string,
  region: string,
  logger: Logger,
): never {
  logger.error(`Blizzard profile API error: ${status} ${text}`);
  if (status === 404)
    throw new NotFoundException(
      `Character "${name}" not found on ${realm} (${region.toUpperCase()}). Check the spelling and realm.`,
    );
  throw new Error(`Blizzard API error (${status}). Please try again later.`);
}

/** Build the Blizzard profile URL (retail only). */
function buildProfileUrl(
  gameVariant: WowGameVariant,
  region: string,
  realmSlug: string,
  charName: string,
): string | null {
  return gameVariant === 'retail'
    ? `https://worldofwarcraft.blizzard.com/en-${region}/character/${realmSlug}/${charName}`
    : null;
}

/** Extract core character fields from raw profile. */
function extractCoreFields(profile: RawBlizzardProfile) {
  const specName = profile.active_spec?.name ?? null;
  return {
    name: profile.name,
    realm: profile.realm.name,
    class: profile.character_class.name,
    spec: specName,
    role: specName ? specToRole(specName) : null,
    level: profile.level,
    race: profile.race.name,
    faction: profile.faction.type.toLowerCase() as 'alliance' | 'horde',
  };
}

/** Build profile result from raw API data. */
export function buildProfileResult(
  profile: RawBlizzardProfile,
  avatarUrl: string | null,
  renderUrl: string | null,
  itemLevel: number | null,
  gameVariant: WowGameVariant,
  region: string,
  realmSlug: string,
  charName: string,
): BlizzardCharacterProfile {
  return {
    ...extractCoreFields(profile),
    itemLevel,
    avatarUrl,
    renderUrl,
    profileUrl: buildProfileUrl(gameVariant, region, realmSlug, charName),
  };
}

/** Fetch raw profile from Blizzard API. */
export async function fetchRawProfile(
  profileUrl: string,
  namespace: string,
  token: string,
  name: string,
  realm: string,
  region: string,
  logger: Logger,
) {
  const profileRes = await fetch(
    `${profileUrl}?namespace=${namespace}&locale=en_US`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!profileRes.ok)
    throwProfileError(
      profileRes.status,
      await profileRes.text(),
      name,
      realm,
      region,
      logger,
    );
  return (await profileRes.json()) as RawBlizzardProfile & {
    equipped_item_level?: number;
  };
}

/** Fetch equipped item level from equipment summary endpoint. */
export async function fetchEquipItemLevel(
  profileUrl: string,
  namespace: string,
  token: string,
  logger: Logger,
): Promise<number | null> {
  try {
    const equipRes = await fetch(
      `${profileUrl}/equipment?namespace=${namespace}&locale=en_US`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (equipRes.ok) {
      const equip = (await equipRes.json()) as { equipped_item_level?: number };
      return equip.equipped_item_level ?? null;
    }
  } catch (err) {
    logger.warn(`Failed to fetch equipment summary: ${err}`);
  }
  return null;
}

/** Fetch raw profile data, media, and item level for a character. */
export async function fetchProfileData(
  name: string,
  realm: string,
  region: string,
  gameVariant: WowGameVariant,
  token: string,
  logger: Logger,
) {
  const params = buildCharacterParams(name, realm, region, gameVariant);
  const profileUrl = `${params.baseUrl}/profile/wow/character/${params.realmSlug}/${params.charName}`;
  const profile = await fetchRawProfile(
    profileUrl,
    params.namespace,
    token,
    name,
    realm,
    region,
    logger,
  );
  const media = await fetchCharacterMedia(profileUrl, params.namespace, token);
  const itemLevel =
    profile.equipped_item_level ??
    (await fetchEquipItemLevel(profileUrl, params.namespace, token, logger));
  return { profile, ...media, itemLevel, ...params };
}
