/**
 * ROK-1170: WoW: Forever guild summary client — founded date, faction and the
 * Blizzard guild id from the realmless `data/wow/guild/<slug>` endpoint. The
 * Forever body shape is UNVERIFIED (spec FLAG F1), so the mapper is tolerant:
 * every field is read as `unknown`, and anything absent or invalid is null.
 */
import { blizzardUpstreamError } from './blizzard-upstream-error';
import {
  buildForeverGuildUrl,
  isRecord,
} from './blizzard-forever-guild.helpers';

type Logger = { warn: (msg: string) => void };

/** The fields Raid Ledger reads from a Forever guild summary. */
export interface ForeverGuildSummary {
  blizzardGuildId: number | null;
  foundedAt: Date | null;
  faction: 'Alliance' | 'Horde' | null;
}

/** Outcome of one summary fetch: a 200 body, or a 404. */
export type SummaryFetch =
  { kind: 'found'; summary: ForeverGuildSummary } | { kind: 'not_found' };

/** Earliest plausible founded date: WoW launched in November 2004. */
const EARLIEST_FOUNDED_MS = Date.UTC(2004, 0, 1);
const ONE_DAY_MS = 86_400_000;

const FACTIONS: Readonly<Record<string, ForeverGuildSummary['faction']>> = {
  ALLIANCE: 'Alliance',
  HORDE: 'Horde',
};

/**
 * Build the realmless guild summary URL (Forever profile namespace).
 * @param guildSlug - Guild slug as given (lowercased and encoded).
 * @param region - Blizzard region.
 * @throws BadRequestException on a slug outside `GUILD_SLUG_RE`.
 */
export function buildForeverGuildSummaryUrl(
  guildSlug: string,
  region: string,
): string {
  return buildForeverGuildUrl(guildSlug, region, '');
}

/** Epoch ms or an ISO string inside 2004..now+1d, else null. */
function toFoundedAt(value: unknown, now: number): Date | null {
  const ms =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Date.parse(value)
        : Number.NaN;
  if (!Number.isFinite(ms)) return null;
  if (ms < EARLIEST_FOUNDED_MS || ms > now + ONE_DAY_MS) return null;
  return new Date(ms);
}

/** `faction.type` (ALLIANCE/HORDE, any casing), else a `faction.name` string. */
function toFaction(value: unknown): ForeverGuildSummary['faction'] {
  if (!isRecord(value)) return null;
  for (const candidate of [value.type, value.name]) {
    if (typeof candidate !== 'string') continue;
    const faction = FACTIONS[candidate.toUpperCase()];
    if (faction) return faction;
  }
  return null;
}

/** A positive safe integer, else null. */
function toGuildId(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

/**
 * Map a raw summary body; every field falls back to null on its own.
 * @param body - Parsed JSON from the summary endpoint.
 * @param now - Clock (epoch ms) bounding the founded date; defaults to now.
 */
export function mapForeverGuildSummary(
  body: unknown,
  now: number = Date.now(),
): ForeverGuildSummary {
  if (!isRecord(body)) {
    return { blizzardGuildId: null, foundedAt: null, faction: null };
  }
  return {
    blizzardGuildId: toGuildId(body.id),
    foundedAt: toFoundedAt(body.created_timestamp, now),
    faction: toFaction(body.faction),
  };
}

/**
 * Fetch a Forever guild summary. `not_found` on 404; a 502 on any other
 * non-2xx (a 403 is a namespace refusal, see `isNamespaceRefusal`).
 * @param guildSlug - Guild slug as given.
 * @param region - Blizzard region.
 * @param token - Blizzard OAuth access token.
 * @param logger - Logger for the expected 404.
 */
export async function fetchForeverGuildSummary(
  guildSlug: string,
  region: string,
  token: string,
  logger: Logger,
): Promise<SummaryFetch> {
  const res = await fetch(buildForeverGuildSummaryUrl(guildSlug, region), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) {
    logger.warn(`Forever guild summary 404 for ${guildSlug} (${region})`);
    return { kind: 'not_found' };
  }
  if (!res.ok) {
    throw blizzardUpstreamError(
      res.status,
      'characters',
      `Blizzard API error (${res.status}). Please try again later.`,
    );
  }
  return { kind: 'found', summary: mapForeverGuildSummary(await res.json()) };
}
