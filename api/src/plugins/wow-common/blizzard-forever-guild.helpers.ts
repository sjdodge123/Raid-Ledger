/**
 * Minimal WoW: Forever guild roster client (ROK-2102 B.4). No sync, no cron:
 * a fetch + defensive mapping only. The Forever roster body has not been
 * recorded yet, so every field is read as `unknown` and narrowed; a member
 * without a string name or numeric level/rank is dropped rather than guessed.
 *
 * FLAG B4: guild-slug rules (spaces → `-`?) are unverified, so the slug is
 * taken as given — only lowercased and percent-encoded.
 */
import { BadRequestException } from '@nestjs/common';
import { blizzardUpstreamError } from './blizzard-upstream-error';
import { getNamespacePrefixes } from './blizzard.constants';
import { FOREVER_NAMESPACE_ALIAS } from './forever-namespace.resolver';

type Logger = { warn: (msg: string) => void };

/** One roster member, as far as the unverified Forever shape allows. */
export interface ForeverGuildMember {
  name: string;
  level: number;
  /** Null when the body carries no numeric `playable_class.id`. */
  classId: number | null;
  rank: number;
}

/** A Forever guild roster. */
export interface ForeverGuildRoster {
  members: ForeverGuildMember[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Map one raw roster entry (`{ character: {...}, rank }`), or null. */
function mapMember(entry: unknown): ForeverGuildMember | null {
  if (!isRecord(entry) || !isRecord(entry.character)) return null;
  const { name, level, playable_class: playableClass } = entry.character;
  const numericLevel = numberOrNull(level);
  const rank = numberOrNull(entry.rank);
  if (typeof name !== 'string' || numericLevel === null || rank === null) {
    return null;
  }
  const classId = isRecord(playableClass)
    ? numberOrNull(playableClass.id)
    : null;
  return { name, level: numericLevel, classId, rank };
}

/**
 * Map a raw roster body defensively; a missing or malformed `members` array
 * yields an empty roster.
 * @param body - Parsed JSON from the roster endpoint.
 */
export function mapForeverGuildRoster(body: unknown): ForeverGuildRoster {
  const raw = isRecord(body) && Array.isArray(body.members) ? body.members : [];
  const members: ForeverGuildMember[] = [];
  for (const entry of raw) {
    const member = mapMember(entry);
    if (member) members.push(member);
  }
  return { members };
}

/**
 * Build the roster URL under the Forever profile namespace.
 * @param guildSlug - Guild slug as given (lowercased and encoded here).
 * @param region - Blizzard region (`us`, `eu`, ...).
 */
/** Accepted guild slug shape (FLAG B4: rules unverified; letters/digits/hyphens, 2–64). */
const GUILD_SLUG_RE = /^[\p{L}\p{N}-]{2,64}$/u;

export function buildForeverGuildRosterUrl(
  guildSlug: string,
  region: string,
): string {
  const lowered = guildSlug.toLowerCase();
  // Letters, digits and hyphens only: `.`/`..` survive encodeURIComponent and
  // would let fetch normalise the path to another Blizzard route (review r1).
  if (!GUILD_SLUG_RE.test(lowered)) {
    throw new BadRequestException('Invalid guild slug');
  }
  const { profile } = getNamespacePrefixes(FOREVER_NAMESPACE_ALIAS);
  const slug = encodeURIComponent(lowered);
  return `https://${region}.api.blizzard.com/data/wow/guild/${slug}/roster?namespace=${profile}-${region}&locale=en_US`;
}

/**
 * Fetch a Forever guild roster. Null on 404; a 502 on any other non-2xx
 * (a 403 is a namespace refusal, see `isNamespaceRefusal`).
 * @param guildSlug - Guild slug as given.
 * @param region - Blizzard region.
 * @param token - Blizzard OAuth access token.
 * @param logger - Logger for the expected 404.
 */
export async function fetchForeverGuildRoster(
  guildSlug: string,
  region: string,
  token: string,
  logger: Logger,
): Promise<ForeverGuildRoster | null> {
  const res = await fetch(buildForeverGuildRosterUrl(guildSlug, region), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) {
    logger.warn(`Forever guild roster 404 for ${guildSlug} (${region})`);
    return null;
  }
  if (!res.ok) {
    throw blizzardUpstreamError(
      res.status,
      'characters',
      `Blizzard API error (${res.status}). Please try again later.`,
    );
  }
  return mapForeverGuildRoster(await res.json());
}
