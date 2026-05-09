/**
 * Failure-snapshot helper for the integration suite (ROK-1249, AC2).
 *
 * Captures five state buckets at the moment a `socket hang up` /
 * ECONNRESET surfaces, writes a timestamped JSON file under
 * planning-artifacts/test-infra-snapshots/, and returns the file path.
 *
 * MUST be defensive: every bucket read is wrapped in try/catch with a
 * 500ms hard timeout so a bug in the snapshotter cannot amplify the very
 * flake it diagnoses (Layer 2 diagnostic §AC2 edge case).
 */
import * as fs from 'fs';
import * as path from 'path';
import { SchedulerRegistry } from '@nestjs/schedule';
import { getTestAppInstance } from './test-app';
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

const SNAPSHOT_DIR = path.resolve(
  __dirname,
  '../../../../planning-artifacts/test-infra-snapshots',
);

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

interface RequestContext {
  method: string;
  url: string;
  elapsedMs: number;
}

/** Race a promise against a 500ms timeout to guarantee the snapshotter
 * never amplifies the very flake it diagnoses. */
async function withTimeout<T>(
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

async function readPostgresPool(
  instance: ReturnType<typeof getTestAppInstance>,
): Promise<unknown> {
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
          "SELECT count(*)::text AS count FROM pg_stat_activity WHERE state IS NOT NULL",
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

function readWorkerFromHost(host: unknown): {
  isRunning: boolean | null;
  isPaused: boolean | null;
} {
  const worker = (host as { worker?: unknown })?.worker as
    | { isRunning?: () => boolean; isPaused?: () => boolean }
    | undefined;
  if (!worker) return { isRunning: null, isPaused: null };
  let isRunning: boolean | null = null;
  let isPaused: boolean | null = null;
  try {
    isRunning = typeof worker.isRunning === 'function' ? worker.isRunning() : null;
  } catch {
    isRunning = null;
  }
  try {
    isPaused = typeof worker.isPaused === 'function' ? worker.isPaused() : null;
  } catch {
    isPaused = null;
  }
  return { isRunning, isPaused };
}

async function readBullmqWorkers(
  instance: ReturnType<typeof getTestAppInstance>,
): Promise<unknown[]> {
  const app = (instance as { app?: { get: (t: unknown, o?: unknown) => unknown } } | null)
    ?.app;
  if (!app) {
    return PROCESSOR_CLASSES.map((p) => ({ name: p.name, status: 'no-app' }));
  }
  const results: unknown[] = [];
  for (const { name, ctor } of PROCESSOR_CLASSES) {
    const entry = await safeRead(`bullmq:${name}`, () => {
      let host: unknown = null;
      try {
        host = app.get(ctor as never, { strict: false });
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

function summarizeHandle(h: unknown): { constructorName: string; summary: string } {
  const ctorName =
    (h as { constructor?: { name?: string } })?.constructor?.name ?? 'Unknown';
  let summary = '';
  const obj = h as Record<string, unknown>;
  if (typeof obj?.fd === 'number') summary += `fd=${obj.fd} `;
  const addr = obj?.address;
  if (typeof addr === 'function') {
    try {
      summary += `addr=${JSON.stringify((addr as () => unknown)())} `;
    } catch {
      // ignore
    }
  }
  if (typeof obj?._idleTimeout === 'number') {
    summary += `idleTimeout=${obj._idleTimeout} `;
  }
  return { constructorName: ctorName, summary: summary.trim() };
}

async function readActiveHandles(): Promise<unknown> {
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

async function readCronJobs(
  instance: ReturnType<typeof getTestAppInstance>,
): Promise<unknown[]> {
  const result = await safeRead('cronJobs', () => {
    const app = (
      instance as { app?: { get: (t: unknown, o?: unknown) => unknown } } | null
    )?.app;
    if (!app) return [];
    let scheduler: SchedulerRegistry | null = null;
    try {
      scheduler = app.get(SchedulerRegistry as never, {
        strict: false,
      }) as SchedulerRegistry | null;
    } catch {
      return [];
    }
    if (!scheduler) return [];
    const out: unknown[] = [];
    for (const [name, job] of scheduler.getCronJobs()) {
      const j = job as {
        isActive?: boolean;
        lastDate?: () => Date | null;
        nextDate?: () => unknown;
      };
      let last: string | null = null;
      let next: string | null = null;
      try {
        last = j.lastDate?.()?.toISOString() ?? null;
      } catch {
        last = null;
      }
      try {
        const n = j.nextDate?.();
        next = n ? String(n) : null;
      } catch {
        next = null;
      }
      out.push({ name, isActive: j.isActive ?? null, lastDate: last, nextDate: next });
    }
    return out;
  });
  return Array.isArray(result) ? result : [];
}

async function readRedisMockStore(
  instance: ReturnType<typeof getTestAppInstance>,
): Promise<unknown> {
  return safeRead('redisMockStore', () => {
    const store = (instance as { redisMock?: { store?: Map<string, string> } } | null)
      ?.redisMock?.store;
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

function buildSnapshotFilePath(): string {
  const iso = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(SNAPSHOT_DIR, `snapshot-${iso}.json`);
}

export async function dumpFailureSnapshot(
  reason: string,
  context?: RequestContext,
): Promise<string> {
  const instance = getTestAppInstance();
  const [postgresPool, bullmqWorkers, activeHandles, cronJobs, redisMockStore] =
    await Promise.all([
      readPostgresPool(instance),
      readBullmqWorkers(instance),
      readActiveHandles(),
      readCronJobs(instance),
      readRedisMockStore(instance),
    ]);
  const snapshot = {
    capturedAt: new Date().toISOString(),
    reason,
    context: context ?? null,
    pid: process.pid,
    postgresPool,
    bullmqWorkers,
    activeHandles,
    cronJobs,
    redisMockStore,
  };
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const filePath = buildSnapshotFilePath();
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
  return filePath;
}
