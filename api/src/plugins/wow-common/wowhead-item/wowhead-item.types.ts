/**
 * ROK-1727: shared types for the Wowhead item resolver.
 * The endpoint is Wowhead's public tooltip backend — undocumented, not a
 * published API; limits are self-imposed (operator Q2, ≤1 req/s).
 */
export type { WowItemMetaRow, WowItemMetaInsert } from '../../../drizzle/schema';

/** Wowhead dataEnv ids: 16 = WoW: Forever (CLASSICPLUS), 4 = Classic. */
export type WowheadEnv = 16 | 4;

export const WOWHEAD_ENV_FOREVER: WowheadEnv = 16;
export const WOWHEAD_ENV_CLASSIC: WowheadEnv = 4;

/** `wow_item_meta.status` values. */
export type WowItemMetaStatus =
  | 'resolved'
  | 'classic_fallback'
  | 'not_found'
  | 'error';

/** Outcome of one tooltip request for one (item, env). */
export type WowheadFetchResult =
  | { kind: 'found'; name: string; quality: number; icon: string | null }
  | { kind: 'not_found' }
  /** 429 / 5xx / network or timeout (status null) — back off and retry. */
  | { kind: 'retryable'; status: number | null };

/** The slice of a fetch Response the resolver reads. */
export interface WowheadResponse {
  status: number;
  json(): Promise<unknown>;
}

/** Injected fetch — `globalThis.fetch` satisfies it. */
export type WowheadFetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<WowheadResponse>;
