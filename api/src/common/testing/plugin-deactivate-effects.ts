/**
 * ROK-2369 — side-effect watch for `plugin-deactivate.integration.spec.ts`.
 * Spies (pass-through) the Drizzle write entry points and BLOCKS the outbound
 * clients (global `fetch`, BullMQ enqueue, Discord bot sends/edits/deletes),
 * so a handler of a deactivated plugin that writes or calls out is named, and
 * one that would call out never reaches the network.
 *
 * {@link probeTarget} also spies the plugin-active gate (`isActive` /
 * `getActiveSlugsSync`) and awaits every promise the target's own methods
 * return, so a `void this.work()` fire-and-forget lands inside the window.
 *
 * Not watched (documented gaps): discord.js sends made directly through
 * `DiscordBotClientService.getClient()` (valheim claim-suggest, sign-in
 * reminder bindings), the Pelican console WebSocket `send`, and work a
 * handler fires on ANOTHER service without awaiting it.
 */
import { Queue } from 'bullmq';
import { DiscordBotClientService } from '../../discord-bot/discord-bot-client.service';

export interface SideEffectWatch {
  /** `name×count` for every watched entry point that was called. */
  effects(): string[];
  restore(): void;
}

/** The Drizzle entry points a write goes through (structural, so a fake fits). */
export interface WritableDb {
  insert: (...args: never[]) => unknown;
  update: (...args: never[]) => unknown;
  delete: (...args: never[]) => unknown;
  transaction: (...args: never[]) => unknown;
  execute: (...args: never[]) => unknown;
}

/** The plugin-active gate every checked handler must consult. */
export interface ActiveGate {
  isActive: (slug: string) => boolean;
  getActiveSlugsSync: () => ReadonlySet<string>;
}

function blocked(): Promise<never> {
  return Promise.reject(
    new Error('ROK-2369: outbound call while the plugin is off'),
  );
}

/** Blocked Discord bot sends, edits and deletes. */
function discordSpies(): Record<string, jest.SpyInstance> {
  const discord = DiscordBotClientService.prototype;
  return {
    'discord.sendDirectMessage': jest
      .spyOn(discord, 'sendDirectMessage')
      .mockImplementation(blocked),
    'discord.sendEmbedDM': jest
      .spyOn(discord, 'sendEmbedDM')
      .mockImplementation(blocked),
    'discord.sendEmbed': jest
      .spyOn(discord, 'sendEmbed')
      .mockImplementation(blocked),
    'discord.editEmbed': jest
      .spyOn(discord, 'editEmbed')
      .mockImplementation(blocked),
    'discord.deleteMessage': jest
      .spyOn(discord, 'deleteMessage')
      .mockImplementation(blocked),
  };
}

/** Start watching writes on `db` and outbound calls process-wide. */
export function watchSideEffects(db: WritableDb): SideEffectWatch {
  const spies: Record<string, jest.SpyInstance> = {
    'db.insert': jest.spyOn(db, 'insert'),
    'db.update': jest.spyOn(db, 'update'),
    'db.delete': jest.spyOn(db, 'delete'),
    'db.transaction': jest.spyOn(db, 'transaction'),
    'db.execute': jest.spyOn(db, 'execute'),
    fetch: jest.spyOn(globalThis, 'fetch').mockImplementation(blocked),
    'queue.add': jest.spyOn(Queue.prototype, 'add').mockImplementation(blocked),
    'queue.addBulk': jest
      .spyOn(Queue.prototype, 'addBulk')
      .mockImplementation(blocked),
    ...discordSpies(),
  };
  return {
    effects: () =>
      Object.entries(spies)
        .filter(([, s]) => s.mock.calls.length > 0)
        .map(([name, s]) => `${name}×${s.mock.calls.length}`),
    restore: () => Object.values(spies).forEach((s) => s.mockRestore()),
  };
}

function isThenable(v: unknown): v is PromiseLike<unknown> {
  return (
    (typeof v === 'object' || typeof v === 'function') &&
    v !== null &&
    typeof Reflect.get(v, 'then') === 'function'
  );
}

/** Prototype-chain method names of `instance` (getters and constructor excluded). */
function methodNames(instance: object): string[] {
  const names = new Set<string>();
  let proto: unknown = Object.getPrototypeOf(instance);
  while (typeof proto === 'object' && proto !== null) {
    if (proto === Object.prototype) break;
    for (const [name, d] of Object.entries(
      Object.getOwnPropertyDescriptors(proto),
    )) {
      if (name !== 'constructor' && typeof d.value === 'function') {
        names.add(name);
      }
    }
    proto = Object.getPrototypeOf(proto);
  }
  return [...names];
}

/**
 * Pass-through spy on every method of `instance` that records each promise
 * it returns; `drain()` awaits them until none are left (no timers).
 */
export function trackAsync(instance: object): {
  drain(): Promise<void>;
  restore(): void;
} {
  const pending: PromiseLike<unknown>[] = [];
  const restores: (() => void)[] = [];
  for (const name of methodNames(instance)) {
    const original: unknown = Reflect.get(instance, name);
    if (typeof original !== 'function') continue;
    const had = Object.prototype.hasOwnProperty.call(instance, name);
    Reflect.set(instance, name, function (this: unknown, ...args: unknown[]) {
      const out: unknown = Reflect.apply(original, this, args);
      if (isThenable(out)) pending.push(out);
      return out;
    });
    restores.push(() =>
      had ? Reflect.set(instance, name, original) : Reflect.deleteProperty(instance, name),
    );
  }
  return {
    drain: async () => {
      while (pending.length > 0) {
        await Promise.allSettled(pending.splice(0));
      }
    },
    restore: () => restores.forEach((r) => r()),
  };
}

/** Let synchronous-emit listeners (e.g. `plugin.deactivated`) settle. */
export async function flushAsync(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

/**
 * Call `instance[method](payload)` and await it. Returns the thrown error
 * (the caller decides what a throw means) or undefined.
 */
export async function invoke(
  instance: object,
  method: string,
  payload: unknown,
): Promise<unknown> {
  const fn: unknown = Reflect.get(instance, method);
  if (typeof fn !== 'function') return new Error(`${method} is not a function`);
  try {
    const out: unknown = Reflect.apply(fn, instance, [payload]);
    await Promise.resolve(out);
  } catch (err: unknown) {
    return err;
  }
  return undefined;
}

/** What firing one handler did: effects, gate consultations, throws. */
export interface ProbeResult {
  key: string;
  effects: string[];
  gateCalls: number;
  errors: unknown[];
}

/** One fire of `t` with `payload`: watch, gate spies, drain, restore. */
async function probeOnce(
  t: { instance: object; method: string },
  deps: { db: WritableDb; gate: ActiveGate },
  payload: unknown,
): Promise<{ effects: string[]; gateCalls: number; error: unknown }> {
  const track = trackAsync(t.instance);
  const watch = watchSideEffects(deps.db);
  const isActive = jest.spyOn(deps.gate, 'isActive');
  const slugs = jest.spyOn(deps.gate, 'getActiveSlugsSync');
  try {
    const error = await invoke(t.instance, t.method, payload);
    await track.drain();
    const gateCalls = isActive.mock.calls.length + slugs.mock.calls.length;
    return { effects: watch.effects(), gateCalls, error };
  } finally {
    isActive.mockRestore();
    slugs.mockRestore();
    watch.restore();
    track.restore();
  }
}

/**
 * Fire `t` with each payload in turn until one reaches the gate (a handler
 * may filter on `payload.slug` before its active check). Effects of every
 * attempt count.
 */
export async function probeTarget(
  t: { key: string; instance: object; method: string },
  deps: { db: WritableDb; gate: ActiveGate },
  payloads: readonly unknown[],
): Promise<ProbeResult> {
  const out: ProbeResult = { key: t.key, effects: [], gateCalls: 0, errors: [] };
  for (const payload of payloads) {
    const r = await probeOnce(t, deps, payload);
    out.effects.push(...r.effects);
    out.gateCalls += r.gateCalls;
    if (r.error !== undefined) out.errors.push(r.error);
    if (out.gateCalls > 0) break;
  }
  return out;
}

const PROGRAMMER_ERRORS = [TypeError, ReferenceError, RangeError, SyntaxError];

function describeError(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

/**
 * Problems with one probe: any effect; a programmer error (the probe crashed
 * the handler, so the gate was never what stopped it); and, with
 * `requireGate`, a handler that never consulted `isActive` /
 * `getActiveSlugsSync` — its active check is missing or unreachable.
 */
export function targetProblems(
  r: ProbeResult,
  opts: { requireGate: boolean },
): string[] {
  const out: string[] = [];
  if (r.effects.length > 0) out.push(`${r.key}: ${r.effects.join(', ')}`);
  for (const err of r.errors) {
    if (PROGRAMMER_ERRORS.some((E) => err instanceof E)) {
      out.push(`${r.key}: threw ${describeError(err)}`);
    }
  }
  if (opts.requireGate && r.gateCalls === 0) {
    const last = r.errors.at(-1);
    const why = last === undefined ? '' : ` (last throw: ${describeError(last)})`;
    out.push(`${r.key}: never consulted isActive/getActiveSlugsSync${why}`);
  }
  return out;
}
