/**
 * Character sync helper functions.
 * Extracted from characters.service.ts for file size compliance (ROK-711).
 */
import type { CharacterSyncAdapter } from '../plugins/plugin-host/extension-points';
import type {
  ExternalCharacterProfessions,
  ExternalCharacterQuests,
} from '../plugins/plugin-host/extension-types';

/** Profile with enriched spec/role/talents from adapter. */
export interface EnrichedProfile {
  profile: {
    name: string;
    /** Null for a realmless WoW: Forever character (ROK-1722). */
    realm: string | null;
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
    /** Blizzard character id, when the adapter surfaces one (ROK-1722). */
    externalId?: string | null;
    /** The body's raw `ruleset` value, unmapped (ROK-2100 maps it). */
    rulesetRaw?: unknown;
  };
  talents: unknown;
  equipment: unknown;
  professions: ExternalCharacterProfessions | null;
  /** Blizzard `quests/completed` ids, Forever only; null = leave alone (ROK-2109). */
  armoryQuests: ExternalCharacterQuests | null;
}

/**
 * ROK-2102/1722: a body without a realm keeps the requested realm; a realmless
 * (Forever) request asks with null and keeps null.
 */
async function fetchRealmProfile(
  adapter: CharacterSyncAdapter,
  name: string,
  realm: string | null,
  region: string,
  nsArg: string | undefined,
): Promise<EnrichedProfile['profile']> {
  const fetched = await adapter.fetchProfile(name, realm, region, nsArg);
  return { ...fetched, realm: fetched.realm ?? realm };
}

/** The requested (not fetched) character address for a follow-up call. */
interface SpecRequest {
  name: string;
  realm: string | null;
  region: string;
  nsArg: string | undefined;
}

/**
 * Infer spec/role from the specialization call (filling only what the
 * profile lacks) and return the talents; null when the class is unknown.
 */
async function fillSpecialization(
  adapter: CharacterSyncAdapter,
  profile: EnrichedProfile['profile'],
  req: SpecRequest,
): Promise<unknown> {
  if (!profile.class) return null;
  const { name, realm, region, nsArg } = req;
  const inferred = await adapter.fetchSpecialization(
    name,
    realm,
    region,
    profile.class,
    nsArg,
  );
  if (!profile.spec && inferred.spec) profile.spec = inferred.spec;
  if (!profile.role && inferred.role) profile.role = inferred.role;
  return inferred.talents ?? null;
}

/** Options for {@link fetchFullProfile}. */
export interface FetchFullProfileOptions {
  /**
   * ROK-2133: false skips the completed-quests call (`armoryQuests` comes
   * back null = "leave alone"). Default true.
   */
  quests?: boolean;
}

/** Equipment, professions and quests in parallel; missing optional fetchers → null. */
async function fetchParallelExtras(
  adapter: CharacterSyncAdapter,
  name: string,
  realm: string | null,
  region: string,
  nsArg: string | undefined,
  includeQuests: boolean,
): Promise<
  Pick<EnrichedProfile, 'equipment' | 'professions' | 'armoryQuests'>
> {
  const [equipment, professions, armoryQuests] = await Promise.all([
    adapter.fetchEquipment(name, realm, region, nsArg),
    adapter.fetchProfessions
      ? adapter.fetchProfessions(name, realm, region, nsArg)
      : Promise.resolve(null),
    includeQuests && adapter.fetchQuests
      ? adapter.fetchQuests(name, realm, region, nsArg)
      : Promise.resolve(null),
  ]);
  return { equipment, professions, armoryQuests };
}

/**
 * Fetch profile, specialization, equipment, and professions from an adapter.
 * Shared across importExternal, refreshExternal, and syncAllCharacters.
 *
 * Equipment, professions and quests are fetched in parallel. Adapters without
 * the optional `fetchProfessions` / `fetchQuests` methods resolve to `null`,
 * which the orchestrator interprets as "leave the prior `armory_professions` /
 * `armory_quests` alone."
 * @param apiNamespacePrefix - The game's namespace prefix (null for retail)
 * @param options - `{ quests: false }` skips the completed-quests call
 */
export async function fetchFullProfile(
  adapter: CharacterSyncAdapter,
  name: string,
  realm: string | null,
  region: string,
  apiNamespacePrefix: string | null,
  options: FetchFullProfileOptions = {},
): Promise<EnrichedProfile> {
  const nsArg = apiNamespacePrefix ?? undefined;
  const profile = await fetchRealmProfile(adapter, name, realm, region, nsArg);
  const talents = await fillSpecialization(adapter, profile, {
    name,
    realm,
    region,
    nsArg,
  });
  const includeQuests = options.quests ?? true;
  const extras = await fetchParallelExtras(
    adapter,
    name,
    realm,
    region,
    nsArg,
    includeQuests,
  );
  return { profile, talents, ...extras };
}

/** Optional sync fields whose presence in a record is conditional. */
export interface OptionalSyncFields {
  /**
   * The Blizzard `/professions` payload. Written to `armoryProfessions` only —
   * the user-entered `professions` column is never touched by a sync
   * (ROK-2107). `null` signals a non-404 adapter failure (5xx, timeout) — the
   * key is omitted so the prior DB value is preserved (architect §3).
   */
  professions: ExternalCharacterProfessions | null;
  /**
   * Blizzard `quests/completed` ids (ROK-2109). Written to `armoryQuests`
   * only when non-null; null = leave the prior value alone. The addon
   * snapshot table is never touched by a sync.
   */
  armoryQuests: ExternalCharacterQuests | null;
  /**
   * The Blizzard equipment payload. `null` = the fetch failed — the key is
   * omitted so the stored gear is kept rather than wiped.
   */
  equipment: unknown;
  talents: unknown;
}

/**
 * Merge optional sync fields into a base record, centralizing the conditional
 * spread so each new optional column is added here once instead of at every
 * call site.
 *
 * `talents` is always applied; `equipment` only when non-null (a failed
 * equipment fetch keeps the stored gear). The Blizzard professions go to
 * `armoryProfessions` only when non-null (a null means "leave the prior value
 * alone"). No `professions` key is ever emitted: that column is user-entered
 * (ROK-2107). The Blizzard quest ids go to `armoryQuests` the same way
 * (ROK-2109).
 */
export function applyOptionalSyncFields(
  record: Record<string, unknown>,
  { professions, armoryQuests, equipment, talents }: OptionalSyncFields,
): Record<string, unknown> {
  return {
    ...record,
    ...(equipment !== null ? { equipment } : {}),
    talents,
    ...(professions !== null ? { armoryProfessions: professions } : {}),
    ...(armoryQuests !== null ? { armoryQuests } : {}),
  };
}

/**
 * Portrait/render URLs to write. A media miss (Blizzard serves 404 on
 * `character-media` for a fresh or just-changed character, and
 * `fetchCharacterMedia` turns any failure into null) keeps the stored URL
 * instead of wiping it — all variants (FOREVER-MEDIA-STATIC §1a).
 */
function mediaFields(profile: EnrichedProfile['profile']): {
  avatarUrl?: string;
  renderUrl?: string;
} {
  return {
    ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
    ...(profile.renderUrl ? { renderUrl: profile.renderUrl } : {}),
  };
}

/**
 * Build the set fields for a character sync update.
 *
 * Positional form kept for callers without quest data — it never writes
 * `armoryQuests`; sync callers use {@link buildSyncUpdateFieldsFromSync}.
 * The Blizzard professions (`armoryProfessions` column, ROK-2107) are **only**
 * included when the value is non-null. A null signals that the adapter encountered a non-404 failure (5xx, timeout,
 * etc.) and the prior column value should be preserved (architect §3).
 */
export function buildSyncUpdateFields(
  profile: EnrichedProfile['profile'],
  equipment: unknown,
  talents: unknown,
  professions: ExternalCharacterProfessions | null,
  extra?: { region?: string; gameVariant?: string },
): Record<string, unknown> {
  return buildSyncUpdateFieldsFromSync(
    profile,
    { equipment, talents, professions, armoryQuests: null },
    extra,
  );
}

/**
 * {@link buildSyncUpdateFields} variant that takes the optional sync fields as a
 * single bundle — every sync caller uses it so new optional columns (e.g.
 * `armoryQuests`, ROK-2109) reach the row. Pass the whole `fetchFullProfile`
 * result as `sync`.
 */
export function buildSyncUpdateFieldsFromSync(
  profile: EnrichedProfile['profile'],
  sync: OptionalSyncFields,
  extra?: { region?: string; gameVariant?: string },
): Record<string, unknown> {
  const base = {
    class: profile.class,
    spec: profile.spec,
    role: profile.role,
    itemLevel: profile.itemLevel,
    level: profile.level,
    race: profile.race,
    faction: profile.faction,
    lastSyncedAt: new Date(),
    profileUrl: profile.profileUrl,
    updatedAt: new Date(),
    ...(extra?.region ? { region: extra.region } : {}),
    ...(extra?.gameVariant ? { gameVariant: extra.gameVariant } : {}),
    ...mediaFields(profile),
  };
  return applyOptionalSyncFields(base, sync);
}
