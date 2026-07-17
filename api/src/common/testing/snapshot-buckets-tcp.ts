/**
 * TCP / kernel-state bucket readers for `dumpFailureSnapshot` (ROK-1264).
 *
 * The ROK-1249/1250 instrumentation captured libuv-tracked handles only.
 * Sockets in `TIME_WAIT` state are NOT visible to `process._getActiveHandles()`
 * — the JS-land FD is closed, but the kernel still holds the 4-tuple for
 * ~60s. If the residual mid-suite TCP RST is driven by ephemeral-port or
 * `TIME_WAIT` accumulation, the older snapshot cannot see it.
 *
 * This module adds three signals that together let the layer-4 spike
 * (`docs/spikes/rok-1250-residual-layer-4.md`) name the carrier:
 *   - `readNetstatTimeWaitBuckets` — shells out to `netstat`/`ss` and
 *     buckets TIME_WAIT counts by peer port.
 *   - `readPeerPortHistogram` — derives a histogram of `remotePort` over
 *     the already-captured libuv socket list. Cheap and runs without exec.
 *   - `readTestServerPort` — records the supertest HTTP server bind port
 *     so the spike doc can correlate the failing port against the snapshot.
 *
 * All readers are defensive: missing CLI tool, parse failure, or non-zero
 * exit returns a `status` placeholder rather than throwing. The snapshot
 * helper must never amplify the flake it diagnoses.
 */
import { spawnSync } from 'child_process';
import type { getTestAppInstance } from './test-app';

type Instance = ReturnType<typeof getTestAppInstance>;

const NETSTAT_TIMEOUT_MS = 500;

interface PortBucket {
  port: number;
  count: number;
}

interface NetstatResult {
  status: 'ok' | 'no-tool' | 'error' | 'parse-error';
  tool?: 'netstat' | 'ss';
  totalTimeWait?: number;
  byPeerPort?: PortBucket[];
  error?: string;
}

/**
 * Parse BSD `netstat -an -p tcp` output (darwin). Local + foreign address
 * columns use `.` as the host/port separator (`127.0.0.1.50624`). State is
 * the last column.
 */
function parseNetstatBsd(stdout: string): Map<number, number> {
  const counts = new Map<number, number>();
  for (const line of stdout.split('\n')) {
    if (!line.includes('TIME_WAIT')) continue;
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5) continue;
    const foreign = cols[4];
    if (!foreign) continue;
    const dot = foreign.lastIndexOf('.');
    if (dot === -1) continue;
    const port = Number(foreign.slice(dot + 1));
    if (!Number.isFinite(port)) continue;
    counts.set(port, (counts.get(port) ?? 0) + 1);
  }
  return counts;
}

/**
 * Parse Linux `ss -tan state time-wait` output. Columns: `Recv-Q Send-Q
 * Local Address:Port Peer Address:Port`. Port separator is `:`.
 */
function parseSsLinux(stdout: string): Map<number, number> {
  const counts = new Map<number, number>();
  const lines = stdout.split('\n').slice(1); // skip header
  for (const line of lines) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4) continue;
    const peer = cols[3];
    if (!peer) continue;
    const colon = peer.lastIndexOf(':');
    if (colon === -1) continue;
    const port = Number(peer.slice(colon + 1));
    if (!Number.isFinite(port)) continue;
    counts.set(port, (counts.get(port) ?? 0) + 1);
  }
  return counts;
}

function bucketsFromMap(counts: Map<number, number>): {
  total: number;
  byPeerPort: PortBucket[];
} {
  let total = 0;
  const buckets: PortBucket[] = [];
  for (const [port, count] of counts) {
    total += count;
    buckets.push({ port, count });
  }
  buckets.sort((a, b) => b.count - a.count);
  return { total, byPeerPort: buckets.slice(0, 20) };
}

function runNetstatBsd(): NetstatResult | null {
  const r = spawnSync('netstat', ['-an', '-p', 'tcp'], {
    encoding: 'utf8',
    timeout: NETSTAT_TIMEOUT_MS,
  });
  if (r.error || r.status !== 0) return null;
  try {
    const counts = parseNetstatBsd(r.stdout);
    const { total, byPeerPort } = bucketsFromMap(counts);
    return {
      status: 'ok',
      tool: 'netstat',
      totalTimeWait: total,
      byPeerPort,
    };
  } catch (err) {
    return {
      status: 'parse-error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function runSsLinux(): NetstatResult | null {
  const r = spawnSync('ss', ['-tan', 'state', 'time-wait'], {
    encoding: 'utf8',
    timeout: NETSTAT_TIMEOUT_MS,
  });
  if (r.error || r.status !== 0) return null;
  try {
    const counts = parseSsLinux(r.stdout);
    const { total, byPeerPort } = bucketsFromMap(counts);
    return { status: 'ok', tool: 'ss', totalTimeWait: total, byPeerPort };
  } catch (err) {
    return {
      status: 'parse-error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * TIME_WAIT bucket — kernel-visible sockets the JS process can't see.
 * Tries BSD `netstat` first (darwin/macOS dev), then Linux `ss`. Returns
 * a placeholder if neither tool is available.
 */
export function readNetstatTimeWaitBuckets(): NetstatResult {
  try {
    const bsd = runNetstatBsd();
    if (bsd) return bsd;
    const linux = runSsLinux();
    if (linux) return linux;
    return { status: 'no-tool' };
  } catch (err) {
    return {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Histogram of `remotePort` across the libuv-tracked TCP socket handles.
 * Pure JS — derived from `process._getActiveHandles()`. Surfaces ioredis
 * (6379), test-postgres-container port, and supertest in-process server
 * port concentrations without depending on any external tool.
 */
export function readPeerPortHistogram(): {
  status: 'ok';
  total: number;
  byPeerPort: PortBucket[];
} {
  const proc = process as unknown as { _getActiveHandles?: () => unknown[] };
  const handles = proc._getActiveHandles?.() ?? [];
  const counts = new Map<number, number>();
  let total = 0;
  for (const h of handles) {
    const ctorName = (h as { constructor?: { name?: string } })?.constructor
      ?.name;
    if (ctorName !== 'Socket') continue;
    const port = (h as { remotePort?: unknown }).remotePort;
    if (typeof port !== 'number') continue;
    total += 1;
    counts.set(port, (counts.get(port) ?? 0) + 1);
  }
  const buckets: PortBucket[] = [];
  for (const [port, count] of counts) buckets.push({ port, count });
  buckets.sort((a, b) => b.count - a.count);
  return { status: 'ok', total, byPeerPort: buckets };
}

interface TestServerPortResult {
  status: 'ok' | 'no-app' | 'no-server' | 'no-address' | 'error';
  port?: number;
  family?: string;
  address?: string;
  error?: string;
}

/**
 * Read the supertest HTTP server's bound port from the live NestJS app.
 * Used to correlate the failing-request `testServerPort` against the
 * peer-port histogram and TIME_WAIT bucket at snapshot time. Without
 * this, layer-4 can't tell which `remotePort=NNNN` entries are "us".
 */
export function readTestServerPort(instance: Instance): TestServerPortResult {
  try {
    const app = (
      instance as {
        app?: { getHttpServer?: () => unknown };
      } | null
    )?.app;
    if (!app) return { status: 'no-app' };
    const server = app.getHttpServer?.() as
      { address?: () => unknown } | undefined;
    if (!server || typeof server.address !== 'function') {
      return { status: 'no-server' };
    }
    const addr = server.address() as {
      port?: number;
      family?: string;
      address?: string;
    } | null;
    if (!addr || typeof addr.port !== 'number') {
      return { status: 'no-address' };
    }
    return {
      status: 'ok',
      port: addr.port,
      family: addr.family,
      address: addr.address,
    };
  } catch (err) {
    return {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
