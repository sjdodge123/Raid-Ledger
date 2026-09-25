/**
 * ROK-1527 opt-in diagnostic — per-spec-file heap retention probe.
 *
 * STRICT no-op unless the flag file `api/.rl-heap-probe` exists (untracked,
 * never committed) or `RL_HEAP_PROBE=1`. When enabled, after each spec
 * file's teardown it:
 *   - forces a full GC,
 *   - counts how many PREVIOUS files' NestApplication instances and sandbox
 *     realms (`globalThis`) are still alive, via WeakRefs created with the
 *     OUTER realm's constructors (so the probe itself pins nothing),
 *   - tags each app with a findable string (`rl-probe-file-<n>`),
 *   - on shard 1 at file SNAP_AT writes a V8 heap snapshot.
 * Output: stdout lines prefixed `[rl-heap-probe]` + /tmp/rl-heap-probe/.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as v8 from 'v8';
import * as vm from 'vm';

const FLAG_FILE = path.resolve(__dirname, '../../../.rl-heap-probe');
const OUT_DIR = '/tmp/rl-heap-probe';
const SNAP_AT = Number(process.env.RL_HEAP_PROBE_SNAP_AT ?? 3);

interface ProbeRef {
  file: number;
  kind: string;
  ref: WeakRef<object>;
}
interface ProbeState {
  file: number;
  refs: ProbeRef[];
  gc: () => void;
}

export function heapProbeEnabled(): boolean {
  return process.env.RL_HEAP_PROBE === '1' || fs.existsSync(FLAG_FILE);
}

/** Probe state lives on the OUTER (main-realm) global, shared by every file. */
function outerState(): ProbeState {
  const outer = vm.runInThisContext('globalThis') as Record<string, unknown>;
  const existing = outer.__rlHeapProbe as ProbeState | undefined;
  if (existing) return existing;
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc') as () => void;
  const state = vm.runInThisContext('({ file: 0, refs: [] })') as ProbeState;
  state.gc = gc;
  outer.__rlHeapProbe = state;
  return state;
}

/**
 * Build the ref entry with an OUTER-realm factory. An object literal written
 * here would be a SANDBOX-realm object whose __proto__ chain (Object.prototype
 * -> Object -> NativeContext) pins this file's whole realm (seen in CI run
 * 36183986959: the probe itself retained file 1 via state.refs[0]).
 */
function outerEntry(file: number, kind: string, target: object): ProbeRef {
  const make = vm.runInThisContext(
    '(f, k, t) => ({ file: f, kind: k, ref: new WeakRef(t) })',
  ) as (f: number, k: string, t: object) => ProbeRef;
  return make(file, kind, target);
}

function countAlive(state: ProbeState, kind: string, before: number): string {
  const prior = state.refs.filter((r) => r.kind === kind && r.file < before);
  const alive = prior.filter((r) => r.ref.deref() !== undefined);
  return `${alive.length}/${prior.length}`;
}

function log(line: string): void {
  const msg = `[rl-heap-probe] pid=${process.pid} shard=${process.env.JEST_SHARD_ID ?? '-'} ${line}\n`;
  process.stdout.write(msg);
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.appendFileSync(path.join(OUT_DIR, `probe-${process.pid}.log`), msg);
  } catch {
    // best-effort
  }
}

/** Call from the global afterAll AFTER closeTestApp(). No-op when disabled. */
export async function heapProbeAfterFile(app: object | null): Promise<void> {
  if (!heapProbeEnabled()) return;
  const state = outerState();
  state.file += 1;
  const n = state.file;
  if (app) {
    (app as Record<string, unknown>).__rlProbeTag = `rl-probe-file-${n}`;
    state.refs.push(outerEntry(n, 'app', app));
  }
  state.refs.push(outerEntry(n, 'realm', globalThis));
  // Let the current job end so earlier WeakRef targets are not kept alive.
  await new Promise<void>((r) => setImmediate(r));
  state.gc();
  state.gc();
  const heapMb = Math.round(process.memoryUsage().heapUsed / 1048576);
  const testPath = expect.getState().testPath ?? '?';
  log(
    `file=${n} heapUsedMB=${heapMb} alivePrevApps=${countAlive(state, 'app', n)} ` +
      `alivePrevRealms=${countAlive(state, 'realm', n)} spec=${path.basename(testPath)}`,
  );
  if (n === SNAP_AT && (process.env.JEST_SHARD_ID ?? '1') === '1') {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const file = path.join(
      OUT_DIR,
      `after-file-${n}-${process.pid}.heapsnapshot`,
    );
    v8.writeHeapSnapshot(file);
    log(`snapshot=${file}`);
  }
}
