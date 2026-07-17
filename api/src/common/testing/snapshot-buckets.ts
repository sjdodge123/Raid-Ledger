/**
 * State-bucket readers used by `dumpFailureSnapshot` (ROK-1249, AC2).
 * Split out of the main helper to keep both files under the 300-line cap.
 *
 * Every public read function is defensive: every call into a NestJS
 * provider, Postgres client, BullMQ worker, or process-internal API is
 * wrapped in try/catch with a 500ms hard timeout via `withTimeout`. A
 * bug in any single bucket cannot prevent the snapshot from being
 * written.
 */
import { SchedulerRegistry } from '@nestjs/schedule';
import type { getTestAppInstance } from './test-app';
import { SteamSyncProcessor } from '../../steam/steam-sync.processor';
import { LineupPhaseProcessor } from '../../lineups/queue/lineup-phase.processor';
import { EnrichmentsProcessor } from '../../enrichments/enrichments.processor';
import { DepartureGraceProcessor } from '../../discord-bot/processors/departure-grace.processor';
import { EventLifecycleProcessor } from '../../discord-bot/processors/event-lifecycle.processor';
import { AdHocGracePeriodProcessor } from '../../discord-bot/processors/ad-hoc-grace-period.processor';
import { EmbedSyncProcessor } from '../../discord-bot/processors/embed-sync.processor';
import { IgdbSyncProcessor } from '../../igdb/igdb-sync.processor';
import { ItadPriceSyncProcessor } from '../../itad/itad-price-sync.processor';
import { GameTasteRecomputeProcessor } from '../../game-taste/processors/game-taste-recompute.processor';
import { EventPlansProcessor } from '../../events/event-plans.processor';
import { BenchPromotionProcessor } from '../../events/bench-promotion.service';
import { DiscordNotificationProcessor } from '../../notifications/discord-notification.processor';

const BUCKET_TIMEOUT_MS = 500;

const PROCESSOR_CLASSES: Array<{ name: string; ctor: unknown }> = [
  { name: 'SteamSyncProcessor', ctor: SteamSyncProcessor },
  { name: 'LineupPhaseProcessor', ctor: LineupPhaseProcessor },
  { name: 'EnrichmentsProcessor', ctor: EnrichmentsProcessor },
  { name: 'DepartureGraceProcessor', ctor: DepartureGraceProcessor },
  { name: 'EventLifecycleProcessor', ctor: EventLifecycleProcessor },
  { name: 'AdHocGracePeriodProcessor', ctor: AdHocGracePeriodProcessor },
  { name: 'EmbedSyncProcessor', ctor: EmbedSyncProcessor },
  { name: 'IgdbSyncProcessor', ctor: IgdbSyncProcessor },
  { name: 'ItadPriceSyncProcessor', ctor: ItadPriceSyncProcessor },
  { name: 'GameTasteRecomputeProcessor', ctor: GameTasteRecomputeProcessor },
  { name: 'EventPlansProcessor', ctor: EventPlansProcessor },
  { name: 'BenchPromotionProcessor', ctor: BenchPromotionProcessor },
  { name: 'DiscordNotificationProcessor', ctor: DiscordNotificationProcessor },
];

type Instance = ReturnType<typeof getTestAppInstance>;

function withTimeout<T>(
  fn: () => Promise<T> | T,
  label: string,
): Promise<T | { status: 'timeout'; bucket: string }> {
  return Promise.race([
    Promise.resolve().then(fn),
    new Promise<{ status: 'timeout'; bucket: string }>((resolve) =>
      setTimeout(
        () => resolve({ status: 'timeout', bucket: label }),
        BUCKET_TIMEOUT_MS,
      ),
    ),
  ]);
}

async function safeRead<T>(
  label: string,
  fn: () => Promise<T> | T,
): Promise<T | { status: string; bucket: string; error?: string }> {
  try {
    return await withTimeout(fn, label);
  } catch (err) {
    return {
      status: 'error',
      bucket: label,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function readPostgresPool(instance: Instance): Promise<unknown> {
  return safeRead('postgresPool', async () => {
    const client = (instance as { _appClient?: unknown } | null)?._appClient as
      | {
          options?: { max?: number };
          unsafe?: (sql: string) => Promise<Array<Record<string, unknown>>>;
        }
      | undefined;
    if (!client) return { status: 'no-client' };
    const max = client.options?.max ?? null;
    let probe: unknown = null;
    if (typeof client.unsafe === 'function') {
      try {
        const rows = await client.unsafe(
          'SELECT count(*)::text AS count FROM pg_stat_activity WHERE state IS NOT NULL',
        );
        probe = rows?.[0] ?? null;
      } catch (err) {
        probe = {
          status: 'pool-unresponsive',
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
    return { configuredMax: max, probe };
  });
}

function callBoolean(fn: (() => boolean) | undefined): boolean | null {
  if (typeof fn !== 'function') return null;
  try {
    return fn();
  } catch {
    return null;
  }
}

function readWorkerFromHost(host: unknown): {
  isRunning: boolean | null;
  isPaused: boolean | null;
} {
  const worker = (host as { worker?: unknown })?.worker as
    { isRunning?: () => boolean; isPaused?: () => boolean } | undefined;
  if (!worker) return { isRunning: null, isPaused: null };
  return {
    isRunning: callBoolean(worker.isRunning),
    isPaused: callBoolean(worker.isPaused),
  };
}

export async function readBullmqWorkers(
  instance: Instance,
): Promise<unknown[]> {
  const app = (
    instance as { app?: { get: (t: unknown, o?: unknown) => unknown } } | null
  )?.app;
  if (!app) {
    return PROCESSOR_CLASSES.map((p) => ({ name: p.name, status: 'no-app' }));
  }
  const results: unknown[] = [];
  for (const { name, ctor } of PROCESSOR_CLASSES) {
    const entry = await safeRead(`bullmq:${name}`, () => {
      let host: unknown;
      try {
        host = app.get(ctor, { strict: false });
      } catch {
        return { name, status: 'not-registered' };
      }
      if (!host) return { name, status: 'not-registered' };
      const { isRunning, isPaused } = readWorkerFromHost(host);
      return { name, isRunning, isPaused };
    });
    results.push(entry);
  }
  return results;
}

function summarizeHandle(h: unknown): {
  constructorName: string;
  summary: string;
} {
  const ctorName =
    (h as { constructor?: { name?: string } })?.constructor?.name ?? 'Unknown';
  let summary = '';
  const obj = h as Record<string, unknown>;
  if (typeof obj?.fd === 'number') summary += `fd=${obj.fd} `;
  // ROK-1250 deeper debug: capture socket peer + local addresses so we can
  // distinguish postgres-js sockets (remotePort=container port) from ioredis
  // sockets (remotePort=6379) from supertest sockets (remotePort=in-process
  // server port). The original `address()` call returns LOCAL bind only;
  // `remote*` fields are set on connected client sockets.
  if (typeof obj?.remoteAddress === 'string') {
    summary += `remote=${obj.remoteAddress}:${obj.remotePort as number} `;
  }
  if (typeof obj?.localAddress === 'string') {
    summary += `local=${obj.localAddress}:${obj.localPort as number} `;
  }
  const addr = obj?.address;
  if (typeof addr === 'function') {
    try {
      summary += `addr=${JSON.stringify((addr as () => unknown)())} `;
    } catch {
      // ignore — address() can throw on closed sockets
    }
  }
  if (typeof obj?._idleTimeout === 'number') {
    summary += `idleTimeout=${obj._idleTimeout} `;
  }
  return { constructorName: ctorName, summary: summary.trim() };
}

export async function readActiveHandles(): Promise<unknown> {
  return safeRead('activeHandles', () => {
    const proc = process as unknown as {
      _getActiveHandles?: () => unknown[];
      _getActiveRequests?: () => unknown[];
    };
    const handles = proc._getActiveHandles?.() ?? [];
    const requests = proc._getActiveRequests?.() ?? [];
    return {
      handles: handles.map(summarizeHandle),
      requests: requests.map(summarizeHandle),
    };
  });
}

interface CronJobLike {
  isActive?: boolean;
  lastDate?: () => Date | null;
  nextDate?: () => unknown;
}

function safeIsoDate(fn: (() => Date | null) | undefined): string | null {
  try {
    return fn?.()?.toISOString() ?? null;
  } catch {
    return null;
  }
}

function safeNextDate(fn: (() => unknown) | undefined): string | null {
  try {
    const n = fn?.();
    if (!n) return null;
    if (n instanceof Date) return n.toISOString();
    const maybeIso = (n as { toISOString?: () => string })?.toISOString;
    if (typeof maybeIso === 'function') return maybeIso.call(n);
    return JSON.stringify(n);
  } catch {
    return null;
  }
}

function mapCronJob(name: string, job: unknown): unknown {
  const j = job as CronJobLike;
  return {
    name,
    isActive: j.isActive ?? null,
    lastDate: safeIsoDate(j.lastDate),
    nextDate: safeNextDate(j.nextDate),
  };
}

function readSchedulerOrNull(
  app: { get: (t: unknown, o?: unknown) => unknown } | undefined,
): SchedulerRegistry | null {
  if (!app) return null;
  try {
    return app.get(SchedulerRegistry, { strict: false }) as SchedulerRegistry;
  } catch {
    return null;
  }
}

export async function readCronJobs(instance: Instance): Promise<unknown[]> {
  const result = await safeRead('cronJobs', () => {
    const app = (
      instance as { app?: { get: (t: unknown, o?: unknown) => unknown } } | null
    )?.app;
    const scheduler = readSchedulerOrNull(app);
    if (!scheduler) return [];
    const out: unknown[] = [];
    for (const [name, job] of scheduler.getCronJobs()) {
      out.push(mapCronJob(name, job));
    }
    return out;
  });
  return Array.isArray(result) ? result : [];
}

export async function readRedisMockStore(instance: Instance): Promise<unknown> {
  return safeRead('redisMockStore', () => {
    const store = (
      instance as { redisMock?: { store?: Map<string, string> } } | null
    )?.redisMock?.store;
    if (!store) return { status: 'no-store' };
    const prefixes: Record<string, { count: number; sample: string[] }> = {};
    for (const key of store.keys()) {
      const prefix = key.split(':')[0] ?? '(root)';
      const entry = (prefixes[prefix] ??= { count: 0, sample: [] });
      entry.count += 1;
      if (entry.sample.length < 5) entry.sample.push(key);
    }
    return { totalKeys: store.size, prefixes };
  });
}
