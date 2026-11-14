/**
 * Opt-in per-spec-file phase timer for the integration suite (ROK-2196).
 *
 * With `RL_INTEGRATION_PHASE_TIMING=1`, every integration spec file prints ONE
 * line to stderr from the setup file's `afterAll`:
 *
 *   [phase-timing] <spec> import=…ms module=…ms init=…ms(onModuleInit=…ms
 *   onApplicationBootstrap=…ms) migrate=…ms|skipped truncate=…ms(×N)
 *   drain=…ms close=…ms total=…ms
 *
 * Unset, every entry point is a no-op apart from a `performance.now()` read:
 * no output, no extra awaits, no behaviour change. State lives on the spec
 * file's own sandbox `globalThis` so a `jest.resetModules()` cannot split it.
 */
import * as path from 'path';
import { performance } from 'perf_hooks';

export const PHASE_TIMING_ENV = 'RL_INTEGRATION_PHASE_TIMING';

export type PhaseName =
  | 'import'
  | 'module'
  | 'init'
  | 'moduleInit'
  | 'bootstrap'
  | 'migrate'
  | 'truncate'
  | 'drain'
  | 'close';

export interface PhaseTotal {
  ms: number;
  count: number;
}

export interface PhaseTimings {
  startedAt: number;
  phases: Partial<Record<PhaseName, PhaseTotal>>;
  migrateSkipped: boolean;
}

const STATE_KEY = Symbol.for('raid-ledger.test.integration-phase-timings');
type GlobalWithTimings = typeof globalThis & {
  [STATE_KEY]?: PhaseTimings;
};

export function isPhaseTimingEnabled(): boolean {
  return process.env[PHASE_TIMING_ENV] === '1';
}

/** Start mark for a phase — a bare clock read, always cheap. */
export function phaseMark(): number {
  return performance.now();
}

export function createPhaseTimings(startedAt: number): PhaseTimings {
  return { startedAt, phases: {}, migrateSkipped: false };
}

/** Accumulate one occurrence of `name` (sum + count). */
export function addPhase(
  timings: PhaseTimings,
  name: PhaseName,
  ms: number,
): void {
  const prev = timings.phases[name];
  timings.phases[name] = {
    ms: (prev?.ms ?? 0) + ms,
    count: (prev?.count ?? 0) + 1,
  };
}

function currentTimings(): PhaseTimings {
  const g = globalThis as GlobalWithTimings;
  const existing = g[STATE_KEY];
  if (existing) return existing;
  const fresh = createPhaseTimings(performance.now());
  g[STATE_KEY] = fresh;
  return fresh;
}

/** Reset this file's timings; the returned mark starts the `total` clock. */
export function beginPhaseTiming(): number {
  const start = performance.now();
  if (isPhaseTimingEnabled()) {
    (globalThis as GlobalWithTimings)[STATE_KEY] = createPhaseTimings(start);
  }
  return start;
}

export function recordPhase(name: PhaseName, start: number): void {
  if (!isPhaseTimingEnabled()) return;
  addPhase(currentTimings(), name, performance.now() - start);
}

/** Record the migrate step: timed when it ran, "skipped" when it did not. */
export function recordMigrate(start: number, ran: boolean): void {
  if (!isPhaseTimingEnabled()) return;
  if (ran) recordPhase('migrate', start);
  else currentTimings().migrateSkipped = true;
}

function ms(total: PhaseTotal | undefined): string {
  return total ? `${Math.round(total.ms)}ms` : 'n/a';
}

function formatInit(phases: PhaseTimings['phases']): string {
  if (!phases.init) return 'n/a';
  const hooks =
    `onModuleInit=${ms(phases.moduleInit)} ` +
    `onApplicationBootstrap=${ms(phases.bootstrap)}`;
  return `${ms(phases.init)}(${hooks})`;
}

/** Pure formatter for the one stderr line (exported for the unit spec). */
export function formatPhaseLine(
  specPath: string,
  timings: PhaseTimings,
  now: number,
): string {
  const p = timings.phases;
  const migrate = timings.migrateSkipped ? 'skipped' : ms(p.migrate);
  const truncate = `${Math.round(p.truncate?.ms ?? 0)}ms(×${p.truncate?.count ?? 0})`;
  return [
    `[phase-timing] ${specPath}`,
    `import=${ms(p.import)}`,
    `module=${ms(p.module)}`,
    `init=${formatInit(p)}`,
    `migrate=${migrate}`,
    `truncate=${truncate}`,
    `drain=${ms(p.drain)}`,
    `close=${ms(p.close)}`,
    `total=${Math.round(now - timings.startedAt)}ms`,
  ].join(' ');
}

/** Print this file's line to stderr and clear its state. */
export function reportPhaseTiming(testPath: string | undefined): void {
  if (!isPhaseTimingEnabled()) return;
  const g = globalThis as GlobalWithTimings;
  const timings = currentTimings();
  const spec = testPath ? path.relative(process.cwd(), testPath) : 'unknown';
  process.stderr.write(`${formatPhaseLine(spec, timings, phaseMark())}\n`);
  delete g[STATE_KEY];
}

type LifecycleHook = () => Promise<void>;
interface LifecycleHookHost {
  callInitHook?: LifecycleHook;
  callBootstrapHook?: LifecycleHook;
}

function wrapHook(
  host: LifecycleHookHost,
  key: keyof LifecycleHookHost,
  phase: PhaseName,
): void {
  const original = host[key];
  if (typeof original !== 'function') return;
  host[key] = async (): Promise<void> => {
    const start = phaseMark();
    try {
      await original.call(host);
    } finally {
      recordPhase(phase, start);
    }
  };
}

/**
 * Split `app.init()` into its onModuleInit / onApplicationBootstrap share by
 * shadowing Nest's (protected) `callInitHook` / `callBootstrapHook` on this
 * instance. Only when enabled — otherwise the app is left untouched.
 */
export function instrumentLifecycleHooks(app: object): void {
  if (!isPhaseTimingEnabled()) return;
  const host = app as LifecycleHookHost;
  wrapHook(host, 'callInitHook', 'moduleInit');
  wrapHook(host, 'callBootstrapHook', 'bootstrap');
}
