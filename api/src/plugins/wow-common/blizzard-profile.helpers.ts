/**
 * Character profile fetching helpers for BlizzardService.
 * Extracted from blizzard.service.ts for file size compliance (ROK-719).
 */
import { NotFoundException } from '@nestjs/common';
import type { BlizzardCharacterProfile } from './blizzard.constants';
import { blizzardUpstreamError } from './blizzard-upstream-error';
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
  /** Blizzard character id. */
  id?: number;
  name: string;
  /** WoW: Forever second name; the display name joins it (ROK-1722). */
  surname?: string;
  /** Forever ruleset as Blizzard sends it (shape unmapped until ROK-2100). */
  ruleset?: unknown;
  level: number;
  character_class: { name: string };
  active_spec?: { name: string };
  race: { name: string };
  faction: { type: string };
  /** Absent on a realmless WoW: Forever body (ROK-2102). */
  realm?: { name: string };
}

/** Throw an HttpException for a failed profile fetch (404 → 404, else 502).
 * A realmless (Forever) 404 is expected for a character below level 10 or
 * not yet logged out, so it is logged at warn with actionable copy (ROK-2102).
 */
export function throwProfileError(
  status: number,
  text: string,
  name: string,
  realm: string | null,
  region: string,
  logger: Logger,
): never {
  const regionLabel = region.toUpperCase();
  if (status === 404 && realm === null) {
    logger.warn(`Blizzard profile API 404 for realmless Forever character`);
    throw new NotFoundException(
      `“${name}” isn't visible on Battle.net yet (${regionLabel}). Forever characters appear after reaching level 10 and logging out once.`,
    );
  }
  logger.error(`Blizzard profile API error: ${status} ${text}`);
  if (status === 404)
    throw new NotFoundException(
      `Character "${name}" not found on ${realm} (${regionLabel}). Check the spelling and realm.`,
    );
  throw blizzardUpstreamError(
    status,
    'characters',
    `Blizzard API error (${status}). Please try again later.`,
  );
}

/** Build the Blizzard profile URL (retail only — null prefix means retail). */
function buildProfileUrl(
  apiNamespacePrefix: string | null,
  region: string,
  realmSlug: string | null,
  charName: string,
): string | null {
  return apiNamespacePrefix === null && realmSlug !== null
    ? `https://worldofwarcraft.blizzard.com/en-${region}/character/${realmSlug}/${charName}`
    : null;
}

/** Extract core character fields from raw profile. */
function extractCoreFields(profile: RawBlizzardProfile) {
  const specName = profile.active_spec?.name ?? null;
  return {
    name: profile.surname ? `${profile.name} ${profile.surname}` : profile.name,
    realm: profile.realm?.name ?? null,
    externalId: typeof profile.id === 'number' ? String(profile.id) : null,
    rulesetRaw: profile.ruleset ?? null,
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
  apiNamespacePrefix: string | null,
  region: string,
  realmSlug: string | null,
  charName: string,
): BlizzardCharacterProfile {
  return {
    ...extractCoreFields(profile),
    itemLevel,
    avatarUrl,
    renderUrl,
    profileUrl: buildProfileUrl(
      apiNamespacePrefix,
      region,
      realmSlug,
      charName,
    ),
  };
}

/** Fetch raw profile from Blizzard API. */
export async function fetchRawProfile(
  profileUrl: string,
  namespace: string,
  token: string,
  name: string,
  realm: string | null,
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
  realm: string | null,
  region: string,
  apiNamespacePrefix: string | null,
  token: string,
  logger: Logger,
) {
  const params = buildCharacterParams(name, realm, region, apiNamespacePrefix);
  const profileUrl = `${params.baseUrl}/profile/wow/character/${params.characterPath}`;
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
