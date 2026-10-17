/**
 * Pure WoW: Forever namespace probe (ROK-1716). No NestJS imports and an
 * injected `fetch`, so the CI canary can reuse it (D9). It only REPORTS what
 * Blizzard answers — nothing here changes app behaviour (D10).
 */
import type {
  ForeverProbeCellDto,
  ForeverProbeEndpoint,
  ForeverProbeMatchDto,
} from '@raid-ledger/contract';

/** Candidate prefixes. `classic` is a known-200 control, never a bare match (D3). */
export const DEFAULT_FOREVER_CANDIDATES: readonly string[] = [
  'classicforever',
  'forever',
  'classicfe',
  'classic2x',
  'classicplus',
  'wowforever',
  'classic',
];

/** Regions probed per candidate. */
export const FOREVER_PROBE_REGIONS: readonly string[] = [
  'us',
  'eu',
  'kr',
  'tw',
];

/** Per-request timeout. */
export const FOREVER_PROBE_TIMEOUT_MS = 10_000;

/** Requests in flight at once. */
const PROBE_CONCURRENCY = 4;

/** Forever launch window `[start, end)` for the hourly job (D7). */
const LAUNCH_WINDOW_START = Date.parse('2026-11-04T00:00:00Z');
const LAUNCH_WINDOW_END = Date.parse('2026-11-19T00:00:00Z');

const PREFIX_RE = /^[a-z0-9]{2,32}$/;
const SKYBORNE_RE = /skyborne/i;

/** The slice of a fetch Response the probe reads. */
export interface ProbeResponse {
  status: number;
  json(): Promise<unknown>;
}

/** Injected fetch — `globalThis.fetch` satisfies it. */
export type ProbeFetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<ProbeResponse>;

/** One request's outcome; null status = network error / timeout. */
export interface ProbeOutcome {
  status: number | null;
  body: unknown;
  error?: string;
}

/** A probe URL tagged with the endpoint it hits. */
export interface ProbeUrl {
  endpoint: ForeverProbeEndpoint;
  url: string;
}

/** Shape summary of a 200 index body (D6). */
export interface ShapeSummary {
  topLevelKeys: string[];
  entryCount: number;
  sample: Record<string, unknown>[];
}

/** Inputs to {@link runProbe}. */
export interface RunProbeInput {
  fetchFn: ProbeFetch;
  token: string;
  candidates: readonly string[];
  regions: readonly string[];
  characterPath: string | null;
  timeoutMs?: number;
}

/** Output of {@link runProbe}; shapes keyed `<prefix>:<region>:<endpoint>`. */
export interface ProbeRun {
  cells: ForeverProbeCellDto[];
  matches: ForeverProbeMatchDto[];
  shapes: Record<string, ShapeSummary>;
}

/** Defaults + valid admin extras (trimmed, lowercased), deduped in order. */
export function buildCandidateList(extras: readonly string[]): string[] {
  const out = [...DEFAULT_FOREVER_CANDIDATES];
  for (const raw of extras) {
    const p = raw.trim().toLowerCase();
    if (PREFIX_RE.test(p) && !out.includes(p)) out.push(p);
  }
  return out;
}

/** The three Game Data URLs probed for one (prefix, region) (D2). */
export function buildProbeUrls(prefix: string, region: string): ProbeUrl[] {
  const base = `https://${region}.api.blizzard.com/data/wow`;
  const q = (kind: string): string =>
    `?namespace=${kind}-${prefix}-${region}&locale=en_US`;
  return [
    { endpoint: 'realm', url: `${base}/realm/index${q('dynamic')}` },
    {
      endpoint: 'connected-realm',
      url: `${base}/connected-realm/index${q('dynamic')}`,
    },
    {
      endpoint: 'playable-race',
      url: `${base}/playable-race/index${q('static')}`,
    },
  ];
}

/** The optional profile URL for a raw `<realmOrRuleset>/<name>` path (D5). */
function buildProfileUrl(path: string, prefix: string, region: string): string {
  const safe = path
    .split('/')
    .map((s) => encodeURIComponent(s.trim().toLowerCase()))
    .join('/');
  return `https://${region}.api.blizzard.com/profile/wow/character/${safe}?namespace=profile-${prefix}-${region}&locale=en_US`;
}

/** GET one URL; never throws. Body is parsed only for a 200. */
export async function probeOne(
  fetchFn: ProbeFetch,
  token: string,
  url: string,
  timeoutMs: number = FOREVER_PROBE_TIMEOUT_MS,
): Promise<ProbeOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    const body = res.status === 200 ? await res.json().catch(() => null) : null;
    return { status: res.status, body };
  } catch (err: unknown) {
    const error = controller.signal.aborted
      ? `timed out after ${timeoutMs}ms`
      : err instanceof Error
        ? err.message
        : String(err);
    return { status: null, body: null, error };
  } finally {
    clearTimeout(timer);
  }
}

/** The playable-race name matching /skyborne/i, or null (D4). */
export function hasSkyborne(body: unknown): string | null {
  const races = (body as { races?: unknown } | null)?.races;
  if (!Array.isArray(races)) return null;
  for (const race of races) {
    const name = (race as { name?: unknown } | null)?.name;
    const names =
      typeof name === 'string'
        ? [name]
        : name && typeof name === 'object'
          ? Object.values(name as Record<string, unknown>)
          : [];
    const hit = names.find((n) => typeof n === 'string' && SKYBORNE_RE.test(n));
    if (typeof hit === 'string') return hit;
  }
  return null;
}

/** Keys + id/name/slug of one index entry. */
function sampleEntry(entry: unknown): Record<string, unknown> {
  if (!entry || typeof entry !== 'object') return { keys: [] };
  const rec = entry as Record<string, unknown>;
  const out: Record<string, unknown> = { keys: Object.keys(rec) };
  for (const k of ['id', 'name', 'slug']) {
    if (rec[k] !== undefined) out[k] = rec[k];
  }
  return out;
}

/** Top-level keys, entry count and a 3-entry sample of an index body (D6). */
export function summariseShape(body: unknown): ShapeSummary {
  if (!body || typeof body !== 'object') {
    return { topLevelKeys: [], entryCount: 0, sample: [] };
  }
  const rec = body as Record<string, unknown>;
  const list = Object.values(rec).find((v) => Array.isArray(v)) as
    unknown[] | undefined;
  return {
    topLevelKeys: Object.keys(rec),
    entryCount: list?.length ?? 0,
    sample: (list ?? []).slice(0, 3).map(sampleEntry),
  };
}

/** True inside `[2026-11-04T00:00Z, 2026-11-19T00:00Z)` (D7). */
export function isInLaunchWindow(now: Date): boolean {
  const t = now.getTime();
  return t >= LAUNCH_WINDOW_START && t < LAUNCH_WINDOW_END;
}

/** Map with at most `limit` promises pending; results keep input order. */
async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  // One shared iterator: each worker pulls the next unclaimed item.
  const queue = items.entries();
  const worker = async (): Promise<void> => {
    for (const [i, item] of queue) out[i] = await fn(item);
  };
  const n = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: n }, worker));
  return out;
}

interface ProbeTask extends ProbeUrl {
  prefix: string;
  region: string;
}

/** A cell for one task's outcome (`error` only when present). */
function toCell(task: ProbeTask, out: ProbeOutcome): ForeverProbeCellDto {
  const { prefix, region, endpoint } = task;
  const cell: ForeverProbeCellDto = {
    prefix,
    region,
    endpoint,
    status: out.status,
  };
  if (out.error !== undefined) cell.error = out.error;
  return cell;
}

/** Fold one outcome into the run: cell, shape (D6) and Skyborne match (D4). */
function collect(run: ProbeRun, task: ProbeTask, out: ProbeOutcome): void {
  run.cells.push(toCell(task, out));
  if (out.status !== 200) return;
  if (task.endpoint === 'playable-race') {
    const raceName = hasSkyborne(out.body);
    if (raceName) {
      run.matches.push({ prefix: task.prefix, region: task.region, raceName });
    }
  } else if (task.endpoint !== 'profile') {
    const key = `${task.prefix}:${task.region}:${task.endpoint}`;
    run.shapes[key] = summariseShape(out.body);
  }
}

/** Probe every (candidate, region, endpoint), then profiles for matches (D5). */
export async function runProbe(input: RunProbeInput): Promise<ProbeRun> {
  const { fetchFn, token, characterPath, timeoutMs } = input;
  const exec = async (t: ProbeTask): Promise<[ProbeTask, ProbeOutcome]> => [
    t,
    await probeOne(fetchFn, token, t.url, timeoutMs),
  ];
  const tasks: ProbeTask[] = input.candidates.flatMap((prefix) =>
    input.regions.flatMap((region) =>
      buildProbeUrls(prefix, region).map((u) => ({ ...u, prefix, region })),
    ),
  );
  const run: ProbeRun = { cells: [], matches: [], shapes: {} };
  for (const [t, out] of await mapPool(tasks, PROBE_CONCURRENCY, exec)) {
    collect(run, t, out);
  }
  if (!characterPath) return run;
  const profiles: ProbeTask[] = run.matches.map(({ prefix, region }) => ({
    prefix,
    region,
    endpoint: 'profile',
    url: buildProfileUrl(characterPath, prefix, region),
  }));
  for (const [t, out] of await mapPool(profiles, PROBE_CONCURRENCY, exec)) {
    collect(run, t, out);
  }
  return run;
}
