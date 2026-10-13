/**
 * Pure helpers for the game-server calendar/status aggregation (ROK-268).
 * Core never names a provider — everything here is provider-agnostic.
 */
import { z } from 'zod';
import type {
  GameServerCalendarItemDto,
  GameServerStatusDto,
} from '@raid-ledger/contract';

/** Per-provider call budget (ROK-268 F1). A timeout is handled exactly like a throw. */
export const GAME_SERVER_PROVIDER_TIMEOUT_MS = 5_000;

/** Minimal logger surface so the helpers stay framework-free. */
export interface WarnLogger {
  warn(message: string): void;
}

/** Rejects after `ms` unless `work` settles first; the timer is always cleared. */
export async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Overwrite `provider` on every object entry so the host label is authoritative (D9). */
function stampProvider(value: unknown, label: string): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((entry: unknown) =>
    entry !== null && typeof entry === 'object'
      ? { ...(entry as Record<string, unknown>), provider: label }
      : entry,
  );
}

/** What `settleProvider` needs to know about one provider call. */
export interface ProviderCall {
  readonly pluginSlug: string;
  readonly providerLabel: string;
  readonly call: () => Promise<unknown>;
}

/**
 * Run one provider call under the timeout, stamp its label and parse it with
 * `schema` (Zod's default strip drops leaked keys). A throw, a timeout or a
 * schema-invalid payload is logged with the plugin slug and yields `[]` (D7).
 */
export async function settleProvider<T>(
  provider: ProviderCall,
  schema: z.ZodType<T>,
  logger: WarnLogger,
): Promise<T[]> {
  const prefix = `game-server provider "${provider.pluginSlug}"`;
  let raw: unknown;
  try {
    raw = await withTimeout(provider.call(), GAME_SERVER_PROVIDER_TIMEOUT_MS);
  } catch (error) {
    logger.warn(`${prefix} failed: ${errorMessage(error)}`);
    return [];
  }
  const parsed = z
    .array(schema)
    .safeParse(stampProvider(raw, provider.providerLabel));
  if (!parsed.success) {
    logger.warn(`${prefix} returned invalid data: ${parsed.error.message}`);
    return [];
  }
  return parsed.data;
}

function matchesGameIds(gameId: number, gameIds?: number[]): boolean {
  return gameIds === undefined || gameIds.includes(gameId);
}

/** Drop windows with `end <= start` and items outside `gameIds` (D8, defence in depth). */
export function keepCalendarItem(
  item: GameServerCalendarItemDto,
  gameIds?: number[],
): boolean {
  if (!matchesGameIds(item.gameId, gameIds)) return false;
  if (item.kind === 'window') {
    return Date.parse(item.end) > Date.parse(item.start);
  }
  return true;
}

/** Keep statuses inside `gameIds` when a filter was given. */
export function keepStatus(
  status: GameServerStatusDto,
  gameIds?: number[],
): boolean {
  return matchesGameIds(status.gameId, gameIds);
}

function calendarInstant(item: GameServerCalendarItemDto): number {
  return Date.parse(item.kind === 'window' ? item.start : item.at);
}

/** Ascending by `start ?? at`, then `serverName`. */
export function compareCalendarItems(
  a: GameServerCalendarItemDto,
  b: GameServerCalendarItemDto,
): number {
  return (
    calendarInstant(a) - calendarInstant(b) ||
    a.serverName.localeCompare(b.serverName)
  );
}

/** By `serverName`, then `serverKey`. */
export function compareStatuses(
  a: GameServerStatusDto,
  b: GameServerStatusDto,
): number {
  return (
    a.serverName.localeCompare(b.serverName) ||
    a.serverKey.localeCompare(b.serverKey)
  );
}
