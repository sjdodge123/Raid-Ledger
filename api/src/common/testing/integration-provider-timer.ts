/**
 * Opt-in per-provider `onModuleInit` timer for integration suites (ROK-2196).
 *
 * With `RL_INTEGRATION_PHASE_TIMING=1`, each spec file prints one extra line
 * after its `[phase-timing]` line naming the slowest providers' (and module
 * classes') `onModuleInit`:
 *
 *   [phase-timing:providers] <spec> WowCommonModule=1203ms Settings=40ms …
 *
 * Nest runs one module's hooks in parallel and modules in sequence, so the
 * numbers overlap within a module; they name the culprit, they do not sum to
 * the phase total. Unset, nothing is wrapped and nothing is printed.
 */
import type { INestApplication } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import * as path from 'path';
import { performance } from 'perf_hooks';
import { isPhaseTimingEnabled } from './integration-phase-timer';

type InitHook = () => unknown;
interface InitHookHost {
  onModuleInit: InitHook;
}
interface WrapperLike {
  name?: unknown;
  instance?: unknown;
}
interface ModuleLike {
  providers: Map<unknown, WrapperLike>;
  controllers: Map<unknown, WrapperLike>;
}
export interface InitHookTarget {
  name: string;
  instance: InitHookHost;
}

const STATE_KEY = Symbol.for('raid-ledger.test.integration-provider-timings');
type GlobalWithTotals = typeof globalThis & {
  [STATE_KEY]?: Map<string, number>;
};

function hasInitHook(x: unknown): x is InitHookHost {
  return (
    typeof x === 'object' &&
    x !== null &&
    'onModuleInit' in x &&
    typeof x.onModuleInit === 'function'
  );
}

/** Shadow `instance.onModuleInit` with a wrapper adding its duration to `totals`. */
export function wrapProviderInitHook(
  instance: InitHookHost,
  name: string,
  totals: Map<string, number>,
  now: () => number = () => performance.now(),
): void {
  const original = instance.onModuleInit;
  instance.onModuleInit = async (): Promise<void> => {
    const start = now();
    try {
      await original.call(instance);
    } finally {
      totals.set(name, (totals.get(name) ?? 0) + (now() - start));
    }
  };
}

/** Every distinct provider/controller instance with an `onModuleInit` hook. */
export function collectInitHookTargets(
  modules: Iterable<ModuleLike>,
): InitHookTarget[] {
  const seen = new Set<unknown>();
  const targets: InitHookTarget[] = [];
  for (const mod of modules) {
    for (const w of [...mod.providers.values(), ...mod.controllers.values()]) {
      if (!hasInitHook(w.instance) || seen.has(w.instance)) continue;
      seen.add(w.instance);
      targets.push({ name: String(w.name), instance: w.instance });
    }
  }
  return targets;
}

/** Pure formatter: slowest first, `>= minMs`, at most `limit` entries. */
export function formatProviderLine(
  specPath: string,
  totals: Map<string, number>,
  opts: { limit: number; minMs: number },
): string {
  const top = [...totals.entries()]
    .filter(([, ms]) => ms >= opts.minMs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, opts.limit)
    .map(([name, ms]) => `${name}=${Math.round(ms)}ms`);
  return [`[phase-timing:providers] ${specPath}`, ...top].join(' ');
}

/** Wrap every provider's `onModuleInit` — call after compile, before init. */
export function instrumentProviderInitHooks(app: INestApplication): void {
  if (!isPhaseTimingEnabled()) return;
  const totals = new Map<string, number>();
  (globalThis as GlobalWithTotals)[STATE_KEY] = totals;
  const modules = app.get(ModulesContainer, { strict: false });
  for (const t of collectInitHookTargets(modules.values())) {
    wrapProviderInitHook(t.instance, t.name, totals);
  }
}

/** Print this file's provider line to stderr and clear its state. */
export function reportProviderTiming(testPath: string | undefined): void {
  if (!isPhaseTimingEnabled()) return;
  const g = globalThis as GlobalWithTotals;
  const totals = g[STATE_KEY];
  if (!totals) return;
  const spec = testPath ? path.relative(process.cwd(), testPath) : 'unknown';
  const line = formatProviderLine(spec, totals, { limit: 12, minMs: 10 });
  process.stderr.write(`${line}\n`);
  delete g[STATE_KEY];
}
