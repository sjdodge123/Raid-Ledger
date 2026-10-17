import { z } from 'zod';
import type {
  WowheadEnv,
  WowheadFetch,
  WowheadFetchResult,
} from './wowhead-item.types';

/** Same UA string as `admin/settings-oauth.helpers.ts`. */
export const WOWHEAD_USER_AGENT =
  'RaidLedger (https://github.com/sjdodge123/Raid-Ledger, 1.0)';
export const WOWHEAD_FETCH_TIMEOUT_MS = 10_000;

const ICON_RE = /^[a-z0-9_]+$/;

/**
 * A hit (HTTP 200) carries `name`, `quality`, `icon` plus `tooltip` HTML and
 * `spells`, which are ignored. A miss is HTTP 404 `{"error":"Entity not found"}`
 * (fixtures `testing/fixtures/wowhead/`, captured 2026-10-09).
 */
const TooltipSchema = z.object({
  name: z.string().min(1).max(255),
  quality: z.number().int().min(0).max(7),
  icon: z.string().optional(),
});

/** The tooltip URL for one item in one Wowhead data env. */
export function buildWowheadItemUrl(itemId: number, env: WowheadEnv): string {
  return `https://nether.wowhead.com/tooltip/item/${itemId}?dataEnv=${env}`;
}

/** The icon slug when safe to interpolate into a URL, else null. */
export function sanitizeIcon(icon: string | undefined): string | null {
  if (!icon) return null;
  const slug = icon.toLowerCase();
  return slug.length <= 100 && ICON_RE.test(slug) ? slug : null;
}

/** Parse a 200 body; anything off-shape is a miss for that env. */
export function parseWowheadTooltip(body: unknown): WowheadFetchResult {
  const parsed = TooltipSchema.safeParse(body);
  if (!parsed.success) return { kind: 'not_found' };
  const { name, quality, icon } = parsed.data;
  return { kind: 'found', name, quality, icon: sanitizeIcon(icon) };
}

/** 429 and 5xx are worth retrying; any other non-200 is a miss. */
function classifyStatus(status: number): WowheadFetchResult {
  if (status === 429 || status >= 500) return { kind: 'retryable', status };
  return { kind: 'not_found' };
}

/** Fetch + classify one (item, env). Never throws. */
export async function fetchWowheadItem(
  itemId: number,
  env: WowheadEnv,
  fetchFn: WowheadFetch,
  timeoutMs: number = WOWHEAD_FETCH_TIMEOUT_MS,
): Promise<WowheadFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(buildWowheadItemUrl(itemId, env), {
      headers: { 'User-Agent': WOWHEAD_USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (res.status !== 200) return classifyStatus(res.status);
    const body = await res.json().catch(() => null);
    return parseWowheadTooltip(body);
  } catch {
    return { kind: 'retryable', status: null };
  } finally {
    clearTimeout(timer);
  }
}
