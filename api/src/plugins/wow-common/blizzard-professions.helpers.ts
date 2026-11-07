/**
 * Profession fetching helpers for BlizzardService.
 * Mirrors blizzard-equipment.helpers.ts (ROK-1130).
 *
 * Edge-case posture (architect §3 + operator directive):
 *   The helper returns `null` whenever there is no actionable profession
 *   data. The orchestrator's `if (professions !== null)` check is the only
 *   write path, so a `null` return guarantees the existing column value
 *   (e.g. a player's manual entry) is left untouched. Cases that produce
 *   `null`:
 *     • Classic-stack namespace (Blizzard Profile API does not expose
 *       /professions for any classic flavor; verified 2026-04-28 against
 *       profile-classicann-us / -classic1x-us / -classic-us). WoW: Forever
 *       is the exception: its realmless profile serves /professions (probe
 *       2026-11-06, ROK-2102), so the Forever alias is attempted.
 *     • 404 from the endpoint.
 *     • Non-OK status (5xx, timeout, network throw).
 *     • 200 OK but the parsed response has zero primary AND zero
 *       secondary entries — Blizzard reporting "no professions" is not
 *       enough to clobber a manual entry.
 *   Only a 200 OK with at least one actual primary or secondary entry
 *   produces a non-null payload that the orchestrator writes to the DB.
 */
import type {
  ExternalCharacterProfessions,
  ExternalProfessionEntry,
  ExternalProfessionTier,
} from '../plugin-host/extension-types';
import { buildCharacterParams } from './blizzard-character.helpers';
import { FOREVER_NAMESPACE_ALIAS } from './forever-namespace.resolver';

type Logger = {
  warn: (msg: string) => void;
  log: (msg: string) => void;
  debug?: (msg: string) => void;
};

interface RawProfessionTier {
  tier?: { id?: number; name?: string };
  skill_points?: number;
  max_skill_points?: number;
}

interface RawProfessionEntry {
  profession?: { id?: number; name?: string };
  skill_points?: number;
  max_skill_points?: number;
  tiers?: RawProfessionTier[];
}

interface RawProfessionsResponse {
  primaries?: RawProfessionEntry[];
  secondaries?: RawProfessionEntry[];
}

/** Slugify a profession or tier name (lowercase + spaces → '-'). */
function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-');
}

/** Map a raw tier into the normalized shape (drops known_recipes). */
function mapProfessionTier(raw: RawProfessionTier): ExternalProfessionTier {
  return {
    id: raw.tier?.id ?? 0,
    name: raw.tier?.name ?? '',
    skillLevel: raw.skill_points ?? 0,
    maxSkillLevel: raw.max_skill_points ?? 0,
  };
}

/** The tier with the highest max skill (the single tier when there is one). */
function headlineTier(
  tiers: ExternalProfessionTier[],
): ExternalProfessionTier | undefined {
  return tiers.reduce<ExternalProfessionTier | undefined>(
    (best, t) =>
      best === undefined || t.maxSkillLevel > best.maxSkillLevel ? t : best,
    undefined,
  );
}

/**
 * Map a raw entry (primary or secondary) into the normalized shape.
 * Blizzard's profile `/professions` carries skill only inside `tiers[]`, so
 * when the top-level values are absent the header comes from the headline
 * tier instead of defaulting to 0/0 (FOREVER-CHARPANEL-AUDIT §3).
 */
function mapProfessionEntry(raw: RawProfessionEntry): ExternalProfessionEntry {
  const name = raw.profession?.name ?? '';
  const tiers = (raw.tiers ?? []).map(mapProfessionTier);
  const headline = headlineTier(tiers);
  return {
    id: raw.profession?.id ?? 0,
    name,
    slug: slugify(name),
    skillLevel: raw.skill_points ?? headline?.skillLevel ?? 0,
    maxSkillLevel: raw.max_skill_points ?? headline?.maxSkillLevel ?? 0,
    tiers,
  };
}

/** Parse the raw professions JSON into the normalized contract shape. */
function parseProfessionsResponse(json: unknown): ExternalCharacterProfessions {
  const raw = (json ?? {}) as RawProfessionsResponse;
  return {
    primary: (raw.primaries ?? []).map(mapProfessionEntry),
    secondary: (raw.secondaries ?? []).map(mapProfessionEntry),
    syncedAt: new Date().toISOString(),
  };
}

/** True when the parsed response has no primary or secondary entries. */
function hasNoEntries(p: ExternalCharacterProfessions): boolean {
  return p.primary.length === 0 && p.secondary.length === 0;
}

/** Issue the request and translate HTTP states into the contract types. */
async function requestProfessions(
  url: string,
  token: string,
  characterPath: string,
  logger: Logger,
): Promise<ExternalCharacterProfessions | null> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) {
    logger.debug?.(
      `Professions 404 for ${characterPath} — leaving prior value alone`,
    );
    return null;
  }
  if (!res.ok) {
    logger.warn(`Professions fetch failed for ${characterPath}: ${res.status}`);
    return null;
  }
  const parsed = parseProfessionsResponse(await res.json());
  if (hasNoEntries(parsed)) {
    logger.debug?.(
      `Professions empty for ${characterPath} — leaving prior value alone`,
    );
    return null;
  }
  return parsed;
}

/** Classic flavours skip /professions; retail and the Forever alias are asked. */
function skipsProfessions(apiNamespacePrefix: string | null): boolean {
  return (
    apiNamespacePrefix !== null &&
    apiNamespacePrefix !== FOREVER_NAMESPACE_ALIAS
  );
}

/** Fetch a WoW character's professions from the Blizzard API. */
export async function fetchCharacterProfessions(
  name: string,
  realm: string | null,
  region: string,
  apiNamespacePrefix: string | null,
  token: string,
  logger: Logger,
): Promise<ExternalCharacterProfessions | null> {
  if (skipsProfessions(apiNamespacePrefix)) {
    logger.debug?.(
      `Skipping professions fetch for ${name}-${realm ?? '(realmless)'} — Classic Profile API does not expose /professions`,
    );
    return null;
  }
  const { characterPath, namespace, baseUrl } = buildCharacterParams(
    name,
    realm,
    region,
    apiNamespacePrefix,
  );
  const url = `${baseUrl}/profile/wow/character/${characterPath}/professions?namespace=${namespace}&locale=en_US`;
  try {
    return await requestProfessions(url, token, characterPath, logger);
  } catch (err) {
    logger.warn(`Failed to fetch character professions: ${err}`);
    return null;
  }
}
