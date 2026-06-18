/**
 * Character sync helper functions.
 * Extracted from characters.service.ts for file size compliance (ROK-711).
 */
import type { CharacterSyncAdapter } from '../plugins/plugin-host/extension-points';
import type { ExternalCharacterProfessions } from '../plugins/plugin-host/extension-types';

/** Profile with enriched spec/role/talents from adapter. */
export interface EnrichedProfile {
  profile: {
    name: string;
    realm: string;
    class: string;
    spec: string | null;
    role: 'tank' | 'healer' | 'dps' | null;
    level: number;
    race: string;
    faction: string | null;
    itemLevel: number | null;
    avatarUrl: string | null;
    renderUrl: string | null;
    profileUrl: string | null;
  };
  talents: unknown;
  equipment: unknown;
  professions: ExternalCharacterProfessions | null;
}

/**
 * Fetch profile, specialization, equipment, and professions from an adapter.
 * Shared across importExternal, refreshExternal, and syncAllCharacters.
 *
 * Equipment + professions are fetched in parallel. Adapters without the
 * optional `fetchProfessions` method resolve to `null`, which the
 * orchestrator interprets as "leave the prior `professions` column alone."
 * @param apiNamespacePrefix - The game's namespace prefix (null for retail)
 */
export async function fetchFullProfile(
  adapter: CharacterSyncAdapter,
  name: string,
  realm: string,
  region: string,
  apiNamespacePrefix: string | null,
): Promise<EnrichedProfile> {
  const nsArg = apiNamespacePrefix ?? undefined;
  const profile = await adapter.fetchProfile(name, realm, region, nsArg);

  let talents: unknown = null;
  if (profile.class) {
    const inferred = await adapter.fetchSpecialization(
      name,
      realm,
      region,
      profile.class,
      nsArg,
    );
    if (!profile.spec && inferred.spec) profile.spec = inferred.spec;
    if (!profile.role && inferred.role) profile.role = inferred.role;
    talents = inferred.talents ?? null;
  }

  const [equipment, professions] = await Promise.all([
    adapter.fetchEquipment(name, realm, region, nsArg),
    adapter.fetchProfessions
      ? adapter.fetchProfessions(name, realm, region, nsArg)
      : Promise.resolve(null),
  ]);
  return { profile, talents, equipment, professions };
}

/** Optional sync fields whose presence in a record is conditional. */
export interface OptionalSyncFields {
  /**
   * `null` signals a non-404 adapter failure (5xx, timeout) — the column is
   * omitted so the prior DB value is preserved (architect §3). Otherwise spread.
   */
  professions: ExternalCharacterProfessions | null;
  equipment: unknown;
  talents: unknown;
}

/**
 * Merge optional sync fields into a base record, centralizing the conditional
 * spread so each new optional column is added here once instead of at every
 * call site.
 *
 * `equipment` and `talents` are always applied; `professions` is applied only
 * when non-null (a null means "leave the prior value alone").
 */
export function applyOptionalSyncFields(
  record: Record<string, unknown>,
  { professions, equipment, talents }: OptionalSyncFields,
): Record<string, unknown> {
  return {
    ...record,
    equipment,
    talents,
    ...(professions !== null ? { professions } : {}),
  };
}

/**
 * Build the set fields for a character sync update.
 *
 * The `professions` column is **only** included when the value is non-null.
 * A null signals that the adapter encountered a non-404 failure (5xx, timeout,
 * etc.) and the prior column value should be preserved (architect §3).
 */
export function buildSyncUpdateFields(
  profile: EnrichedProfile['profile'],
  equipment: unknown,
  talents: unknown,
  professions: ExternalCharacterProfessions | null,
  extra?: { region?: string; gameVariant?: string },
): Record<string, unknown> {
  const base = {
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
    updatedAt: new Date(),
    ...(extra?.region ? { region: extra.region } : {}),
    ...(extra?.gameVariant ? { gameVariant: extra.gameVariant } : {}),
  };
  return applyOptionalSyncFields(base, { professions, equipment, talents });
}

/**
 * {@link buildSyncUpdateFields} variant that takes the optional sync fields as a
 * single bundle — keeps import/merge call sites flat as more fields are added.
 */
export function buildSyncUpdateFieldsFromSync(
  profile: EnrichedProfile['profile'],
  sync: OptionalSyncFields,
  extra?: { region?: string; gameVariant?: string },
): Record<string, unknown> {
  return buildSyncUpdateFields(
    profile,
    sync.equipment,
    sync.talents,
    sync.professions,
    extra,
  );
}
