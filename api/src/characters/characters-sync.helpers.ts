/**
 * Character sync helper functions.
 * Extracted from characters.service.ts for file size compliance (ROK-711).
 */
import type { CharacterSyncAdapter } from '../plugins/plugin-host/extension-points';

/** Profile with enriched spec/role/talents from adapter. */
export interface EnrichedProfile {
  profile: {
    name: string;
    realm: string;
    class: string | null;
    spec: string | null;
    role: 'tank' | 'healer' | 'dps' | null;
    level: number;
    race: string;
    faction: 'alliance' | 'horde';
    itemLevel: number | null;
    avatarUrl: string | null;
    renderUrl: string | null;
    profileUrl: string | null;
  };
  talents: unknown;
  equipment: unknown;
}

/**
 * Fetch profile, specialization, and equipment from an adapter.
 * Shared across importExternal, refreshExternal, and syncAllCharacters.
 */
export async function fetchFullProfile(
  adapter: CharacterSyncAdapter,
  name: string,
  realm: string,
  region: string,
  gameVariant: string,
): Promise<EnrichedProfile> {
  const profile = await adapter.fetchProfile(name, realm, region, gameVariant);

  let talents: unknown = null;
  if (profile.class) {
    const inferred = await adapter.fetchSpecialization(name, realm, region, profile.class, gameVariant);
    if (!profile.spec && inferred.spec) profile.spec = inferred.spec;
    if (!profile.role && inferred.role) profile.role = inferred.role;
    talents = inferred.talents ?? null;
  }

  const equipment = await adapter.fetchEquipment(name, realm, region, gameVariant);
  return { profile, talents, equipment };
}

/** Build the set fields for a character sync update. */
export function buildSyncUpdateFields(
  profile: EnrichedProfile['profile'],
  equipment: unknown,
  talents: unknown,
  extra?: { region?: string; gameVariant?: string },
): Record<string, unknown> {
  return {
    class: profile.class,
    spec: profile.spec,
    role: profile.role,
    itemLevel: profile.itemLevel,
    avatarUrl: profile.avatarUrl,
    renderUrl: profile.renderUrl,
    level: profile.level,
    race: profile.race,
    faction: profile.faction,
    lastSyncedAt: new Date(),
    profileUrl: profile.profileUrl,
    equipment,
    talents,
    updatedAt: new Date(),
    ...(extra?.region ? { region: extra.region } : {}),
    ...(extra?.gameVariant ? { gameVariant: extra.gameVariant } : {}),
  };
}
