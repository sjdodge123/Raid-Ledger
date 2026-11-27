/**
 * ROK-2369 — side-effect watch for `plugin-deactivate.integration.spec.ts`.
 * Spies (pass-through) the Drizzle write entry points and BLOCKS the outbound
 * clients (global `fetch`, BullMQ enqueue, Discord bot sends), so a handler of
 * a deactivated plugin that writes or calls out is named, and one that would
 * call out never reaches the network.
 */
import { Queue } from 'bullmq';
import type { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import { DiscordBotClientService } from '../../discord-bot/discord-bot-client.service';

export interface SideEffectWatch {
  /** `name×count` for every watched entry point that was called. */
  effects(): string[];
  restore(): void;
}

function blocked(): Promise<never> {
  return Promise.reject(
    new Error('ROK-2369: outbound call while the plugin is off'),
  );
}

/** Blocked Discord bot sends. */
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
  };
}

/** Start watching writes on `db` and outbound calls process-wide. */
export function watchSideEffects(
  db: PostgresJsDatabase<typeof schema>,
): SideEffectWatch {
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

/** Let fire-and-forget work queued by the last call settle. */
export async function flushAsync(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

/**
 * Call `instance[method](payload)` and await it. A throw is swallowed and
 * returned: with a probe payload a handler may fail on the payload before
 * its active check; the spec asserts on side effects, not on the return.
 */
export async function invoke(
  instance: object,
  method: string,
  payload: unknown,
): Promise<string | undefined> {
  const fn: unknown = Reflect.get(instance, method);
  if (typeof fn !== 'function') return `${method} is not a function`;
  try {
    const out: unknown = Reflect.apply(fn, instance, [payload]);
    await Promise.resolve(out);
  } catch (err: unknown) {
    return err instanceof Error ? err.message : String(err);
  }
  return undefined;
}

/** Stop every cron job (a plugin re-activation re-registers them started). */
export function stopAllCrons(app: INestApplication): void {
  const scheduler = app.get(SchedulerRegistry, { strict: false });
  for (const [, job] of scheduler.getCronJobs()) {
    void job.stop();
  }
}
