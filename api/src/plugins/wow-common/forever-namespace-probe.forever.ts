/**
 * Pure URL builders + summarisers for the live (realmless) WoW: Forever API
 * shapes (ROK-2102). No NestJS imports — the CI canary reaches this through
 * `forever-namespace-probe.helpers`.
 */
import type {
  ForeverProbeCellDto,
  ForeverProbeEndpoint,
  ForeverProbeMatchDto,
} from '@raid-ledger/contract';
import type { ProbeUrl, ShapeSummary } from './forever-namespace-probe.helpers';

/** One (prefix, region) a follow-up phase probes. */
export interface ProbeTarget {
  prefix: string;
  region: string;
}

/** Endpoints whose shapes carry top-level keys only (anonymised evidence). */
const KEYS_ONLY_ENDPOINTS: ReadonlySet<ForeverProbeEndpoint> = new Set([
  'profile',
  'profile-equipment',
  'profile-professions',
  'profile-quests',
  'profile-media',
  'guild-roster',
]);

/** Profile sub-resources probed after a profile 200. */
const PROFILE_DETAILS: readonly [ForeverProbeEndpoint, string][] = [
  ['profile-equipment', 'equipment'],
  ['profile-professions', 'professions'],
  ['profile-quests', 'quests'],
  ['profile-media', 'character-media'],
];

/** `?namespace=<kind>-<prefix>-<region>&locale=en_US`. */
export function probeQuery(
  kind: string,
  prefix: string,
  region: string,
): string {
  return `?namespace=${kind}-${prefix}-${region}&locale=en_US`;
}

/** Lowercase + encode each segment of a 1- or 2-segment path. */
function encodePath(path: string): string {
  return path
    .split('/')
    .map((s) => encodeURIComponent(s.trim().toLowerCase()))
    .join('/');
}

/** The dynamic `ruleset` index URL for one (prefix, region). */
export function buildRulesetUrl(prefix: string, region: string): ProbeUrl {
  const base = `https://${region}.api.blizzard.com/data/wow`;
  return {
    endpoint: 'ruleset',
    url: `${base}/ruleset/index${probeQuery('dynamic', prefix, region)}`,
  };
}

/** Profile root (no query) for `<realm>/<name>` or a realmless `<slug>`. */
export function profileRoot(path: string, region: string): string {
  return `https://${region}.api.blizzard.com/profile/wow/character/${encodePath(path)}`;
}

/** The character profile URL; one segment = realmless Forever route (D5). */
export function buildProfileUrl(
  path: string,
  prefix: string,
  region: string,
): string {
  return `${profileRoot(path, region)}${probeQuery('profile', prefix, region)}`;
}

/** The four profile sub-resource URLs (same namespace as the profile). */
export function buildProfileDetailUrls(
  path: string,
  prefix: string,
  region: string,
): ProbeUrl[] {
  const root = profileRoot(path, region);
  const q = probeQuery('profile', prefix, region);
  return PROFILE_DETAILS.map(([endpoint, sub]) => ({
    endpoint,
    url: `${root}/${sub}${q}`,
  }));
}

/** Guild roster URL for a realmless `<slug>` or Classic `<realm>/<slug>`. */
export function buildGuildRosterUrl(
  path: string,
  prefix: string,
  region: string,
): string {
  const base = `https://${region}.api.blizzard.com/data/wow/guild`;
  return `${base}/${encodePath(path)}/roster${probeQuery('profile', prefix, region)}`;
}

/** Profile + guild roster URLs for one matched target (each only if set). */
export function buildFollowUpUrls(
  target: ProbeTarget,
  characterPath: string | null,
  guildPath: string | null,
): ProbeUrl[] {
  const { prefix, region } = target;
  const out: ProbeUrl[] = [];
  if (characterPath) {
    const url = buildProfileUrl(characterPath, prefix, region);
    out.push({ endpoint: 'profile', url });
  }
  if (guildPath) {
    const url = buildGuildRosterUrl(guildPath, prefix, region);
    out.push({ endpoint: 'guild-roster', url });
  }
  return out;
}

/** Matches deduped by `prefix:region`, first-seen order. */
export function dedupeTargets(
  matches: readonly ForeverProbeMatchDto[],
): ProbeTarget[] {
  const seen = new Set<string>();
  const out: ProbeTarget[] = [];
  for (const { prefix, region } of matches) {
    const key = `${prefix}:${region}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ prefix, region });
  }
  return out;
}

/** True when the target's profile cell answered 200. */
export function profileAnswered(
  cells: readonly ForeverProbeCellDto[],
  target: ProbeTarget,
): boolean {
  return cells.some(
    (c) =>
      c.endpoint === 'profile' &&
      c.status === 200 &&
      c.prefix === target.prefix &&
      c.region === target.region,
  );
}

/** True for endpoints whose shapes must carry keys only. */
export function isKeysOnlyEndpoint(endpoint: ForeverProbeEndpoint): boolean {
  return KEYS_ONLY_ENDPOINTS.has(endpoint);
}

/** Top-level keys only — never names, ids or entries. */
export function summariseKeys(body: unknown): ShapeSummary {
  const keys = body && typeof body === 'object' ? Object.keys(body) : [];
  return { topLevelKeys: keys, entryCount: 0, sample: [] };
}
