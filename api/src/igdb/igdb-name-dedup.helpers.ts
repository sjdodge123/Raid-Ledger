/**
 * Normalized-name dedup helpers (ROK-1113).
 *
 * Looks up existing game rows whose canonical name normalizes to the same value
 * as the input (e.g., "Slay the Spire 2" matches an existing "Slay the Spire II").
 * Used at ingest time to prevent duplicate rows, and by the admin merge tool to
 * collapse rows that already slipped past.
 *
 * Subtitle stripping in `normalizeForDedup` is aggressive — it collapses
 * "Game: Subtitle" into "game subtitle". A token-count parity check keeps
 * "Doom" from colliding with "Doom: Eternal" (1 vs 2 tokens) while still
 * allowing "Slay the Spire 2" / "Slay the Spire II" (3 tokens each).
 */
import { or, ilike } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { normalizeForDedup } from './igdb-search-dedup.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Row shape used for dedup lookups (only the columns we care about). */
interface NameDedupRow {
  id: number;
  name: string;
  igdbId: number | null;
  steamAppId: number | null;
  itadGameId: string | null;
}

/** Token count for a normalized name. */
function tokenCount(normalized: string): number {
  if (!normalized) return 0;
  return normalized.split(' ').filter(Boolean).length;
}

/** First "significant" token (length >= 2) used as a coarse SQL prefilter. */
function firstSignificantToken(normalized: string): string | null {
  for (const token of normalized.split(' ')) {
    if (token.length >= 2) return token;
  }
  return null;
}

/** True when two normalized names match AND have the same token count. */
function namesMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a !== b) return false;
  return tokenCount(a) === tokenCount(b);
}

/**
 * Find an existing game row whose normalized name matches `name`.
 * Returns null when no row matches.
 *
 * Uses an ILIKE prefilter on the first significant token to keep the row set
 * small, then does the exact normalized comparison in JS.
 */
export async function findGameByNormalizedName(
  db: Db,
  name: string,
): Promise<NameDedupRow | null> {
  const normalized = normalizeForDedup(name);
  if (!normalized) return null;
  const token = firstSignificantToken(normalized);
  if (!token) return null;

  const candidates = await selectCandidatesByToken(db, token);
  for (const row of candidates) {
    if (namesMatch(normalizeForDedup(row.name), normalized)) return row;
  }
  return null;
}

/** Coarse SQL prefilter — rows whose name contains the token (case-insensitive). */
async function selectCandidatesByToken(
  db: Db,
  token: string,
): Promise<NameDedupRow[]> {
  const g = schema.games;
  const escaped = token.replace(/[\\%_]/g, (c) => `\\${c}`);
  return db
    .select({
      id: g.id,
      name: g.name,
      igdbId: g.igdbId,
      steamAppId: g.steamAppId,
      itadGameId: g.itadGameId,
    })
    .from(g)
    .where(ilike(g.name, `%${escaped}%`));
}

/** Lightweight match result for the batch lookup. */
export interface NameMatch {
  id: number;
  igdbId: number | null;
}

/**
 * Batch variant: given a list of canonical names, return a map of
 * `normalizedName -> { id, igdbId }` for any rows that already exist in the DB.
 *
 * Issues ONE SELECT covering all distinct first-significant tokens (using
 * `IN (...)` over a coarse `lower(name)` substring), then matches normalized
 * names in JS.
 */
export async function findGameIdsByNormalizedName(
  db: Db,
  names: string[],
): Promise<Map<string, NameMatch>> {
  const out = new Map<string, NameMatch>();
  if (names.length === 0) return out;

  const wantedByNormalized = buildWantedMap(names);
  if (wantedByNormalized.size === 0) return out;

  const tokens = collectTokens(wantedByNormalized.keys());
  if (tokens.size === 0) return out;

  const rows = await selectCandidatesByTokenSet(db, [...tokens]);
  for (const row of rows) {
    const norm = normalizeForDedup(row.name);
    if (!wantedByNormalized.has(norm)) continue;
    if (tokenCount(norm) !== wantedByNormalized.get(norm)) continue;
    if (!out.has(norm)) out.set(norm, { id: row.id, igdbId: row.igdbId });
  }
  return out;
}

/** Map of normalizedName -> token count for the input names. */
function buildWantedMap(names: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const name of names) {
    const norm = normalizeForDedup(name);
    if (norm && !map.has(norm)) map.set(norm, tokenCount(norm));
  }
  return map;
}

/** Set of distinct first-significant tokens drawn from normalized names. */
function collectTokens(normalizedNames: Iterable<string>): Set<string> {
  const tokens = new Set<string>();
  for (const norm of normalizedNames) {
    const token = firstSignificantToken(norm);
    if (token) tokens.add(token);
  }
  return tokens;
}

/**
 * Coarse SQL prefilter for the batch path: any row whose name contains any
 * token (case-insensitive).
 *
 * Built from PARAMETERIZED `ilike` predicates OR'd together — NOT `sql.raw`.
 * The previous `sql.raw` interpolation only escaped `\ % _` and broke on an
 * apostrophe in a token (e.g. "baldur's" → `LIKE '%baldur's%'` syntax error),
 * which is a quote-injection class bug for any game name with an apostrophe
 * ("Assassin's Creed", "Tom Clancy's …"). ROK-1334.
 */
async function selectCandidatesByTokenSet(
  db: Db,
  tokens: string[],
): Promise<NameDedupRow[]> {
  const g = schema.games;
  const clauses = tokens.map((t) => {
    const escaped = t.replace(/[\\%_]/g, (c) => `\\${c}`);
    return ilike(g.name, `%${escaped}%`);
  });
  return db
    .select({
      id: g.id,
      name: g.name,
      igdbId: g.igdbId,
      steamAppId: g.steamAppId,
      itadGameId: g.itadGameId,
    })
    .from(g)
    .where(or(...clauses));
}

/** A name-keyed duplicate group with all member rows (winner not yet picked). */
export interface NameDuplicateGroup {
  normalizedName: string;
  rows: NameDedupRow[];
}

/**
 * Find groups of `(id, name, igdbId, steamAppId, itadGameId)` rows whose
 * normalized name (and token count) collide.
 *
 * Skips groups where >=2 distinct non-null igdbIds appear — those are intentional
 * sequels/variants (e.g., GTA V remakes). They are returned in the second
 * tuple element so admins can review them manually.
 */
export async function findDuplicateGroupsByNormalizedName(
  db: Db,
): Promise<{ groups: NameDuplicateGroup[]; skipped: NameDuplicateGroup[] }> {
  const allRows = await selectAllRows(db);
  const buckets = bucketByNormalized(allRows);
  return splitGroups(buckets);
}

/** Select all rows we need to inspect for the dedup pass. */
async function selectAllRows(db: Db): Promise<NameDedupRow[]> {
  const g = schema.games;
  return db
    .select({
      id: g.id,
      name: g.name,
      igdbId: g.igdbId,
      steamAppId: g.steamAppId,
      itadGameId: g.itadGameId,
    })
    .from(g);
}

/** Group rows by `${normalized}|${tokenCount}` so token-count mismatches don't merge. */
function bucketByNormalized(rows: NameDedupRow[]): Map<string, NameDedupRow[]> {
  const buckets = new Map<string, NameDedupRow[]>();
  for (const row of rows) {
    const norm = normalizeForDedup(row.name);
    if (!norm) continue;
    const key = `${norm}|${tokenCount(norm)}`;
    const list = buckets.get(key) ?? [];
    list.push(row);
    buckets.set(key, list);
  }
  return buckets;
}

/** Split bucketed rows into mergeable groups vs admin-review groups. */
function splitGroups(buckets: Map<string, NameDedupRow[]>): {
  groups: NameDuplicateGroup[];
  skipped: NameDuplicateGroup[];
} {
  const groups: NameDuplicateGroup[] = [];
  const skipped: NameDuplicateGroup[] = [];
  for (const [key, rows] of buckets) {
    if (rows.length < 2) continue;
    const normalizedName = key.split('|')[0];
    const distinctIgdbIds = new Set(
      rows.map((r) => r.igdbId).filter((id): id is number => id != null),
    );
    if (distinctIgdbIds.size >= 2) {
      skipped.push({ normalizedName, rows });
    } else {
      groups.push({ normalizedName, rows });
    }
  }
  return { groups, skipped };
}

/**
 * Pick the winner row in a name group.
 * Priority: igdbId+itadGameId > igdbId > itadGameId > steamAppId > lowest id.
 */
export function pickNameGroupWinner(rows: NameDedupRow[]): NameDedupRow {
  const sorted = [...rows].sort((a, b) => a.id - b.id);
  return (
    sorted.find((r) => r.igdbId != null && r.itadGameId != null) ??
    sorted.find((r) => r.igdbId != null) ??
    sorted.find((r) => r.itadGameId != null) ??
    sorted.find((r) => r.steamAppId != null) ??
    sorted[0]
  );
}
