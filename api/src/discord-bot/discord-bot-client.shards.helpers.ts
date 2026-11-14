// Imported from @discordjs/ws (what discord.js re-exports) so specs that
// jest.mock('discord.js') still get the real base class.
import { SimpleShardingStrategy } from '@discordjs/ws';
import type { Client, ClientOptions } from 'discord.js';

/**
 * ROK-2198: why this file exists.
 *
 * discord.js 14.27 cannot always close a client's gateway session:
 * - `Client.login()` already calls `destroy()` before it rethrows, and the
 *   client's WebSocketManager returns early from every later `destroy()`.
 * - `@discordjs/ws` `WebSocketShard.destroy()` is a no-op while the shard is
 *   Idle — which it is during the 500 ms before an internal reconnect. The
 *   strategy then forgets the shard (`shards.clear()`), the pending reconnect
 *   fires anyway, and the shard identifies and stays connected with nothing
 *   left that can reach it. That is the zombie bot seen on prod.
 *
 * The fix keeps our own reference to every shard a client ever spawned, and
 * once its strategy has been destroyed closes any shard that comes back.
 */

type WsOptions = NonNullable<ClientOptions['ws']>;
type BuildStrategy = NonNullable<WsOptions['buildStrategy']>;
/** The `@discordjs/ws` manager discord.js hands to `buildStrategy`. */
export type GatewayManager = Parameters<BuildStrategy>[0];
type StrategyDestroyOptions = Parameters<SimpleShardingStrategy['destroy']>[0];

const CLOSE = { code: 1000, reason: 'Raid Ledger discarded this client' };
const nextTick = (): Promise<void> => new Promise((r) => setImmediate(r));

/**
 * The slice of an `@discordjs/ws` WebSocketShard we use. discord.js exports
 * its own, different `WebSocketShard`, so the ws one is matched by shape.
 */
export interface GatewayShard {
  readonly status: number;
  destroy(options: { code: number; reason: string }): Promise<void>;
  on(event: string, listener: () => void): unknown;
}

/** `@discordjs/ws` WebSocketShardStatus.Idle and the shard event names. */
const SHARD_IDLE = 0;
const SHARD_UP_EVENTS = ['ready', 'resumed'] as const;

function isGatewayShard(value: unknown): value is GatewayShard {
  if (typeof value !== 'object' || value === null) return false;
  return (
    typeof Reflect.get(value, 'status') === 'number' &&
    typeof Reflect.get(value, 'destroy') === 'function' &&
    typeof Reflect.get(value, 'on') === 'function'
  );
}

/** Read the strategy's private shard map through a narrow runtime guard. */
function shardsOf(strategy: SimpleShardingStrategy): GatewayShard[] {
  const shards: unknown = Reflect.get(strategy, 'shards');
  if (!(shards instanceof Map)) return [];
  const values: Iterable<unknown> = shards.values();
  return Array.from(values).filter(isGatewayShard);
}

export class TrackingShardingStrategy extends SimpleShardingStrategy {
  private retired = false;
  private readonly spawned = new Set<GatewayShard>();
  private readonly pending = new Set<Promise<void>>();

  override async spawn(shardIds: number[]): Promise<void> {
    await super.spawn(shardIds);
    for (const shard of shardsOf(this)) this.track(shard);
  }

  override async destroy(options?: StrategyDestroyOptions): Promise<void> {
    this.retired = true;
    await super.destroy(options);
  }

  /** Every shard this strategy spawned, even after discord.js forgot it. */
  allShards(): GatewayShard[] {
    return [...this.spawned];
  }

  /** Close every spawned shard that is not Idle; returns how many. */
  async closeAll(): Promise<number> {
    await nextTick();
    const live = this.allShards().filter((s) => s.status !== SHARD_IDLE);
    await Promise.all(live.map((s) => s.destroy(CLOSE)));
    return live.length;
  }

  /** Resolves once every retired-shard close started so far has finished. */
  async settled(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  private track(shard: GatewayShard): void {
    if (this.spawned.has(shard)) return;
    this.spawned.add(shard);
    const closeIfRetired = (): void => {
      if (this.retired) this.closeLater(shard);
    };
    for (const event of SHARD_UP_EVENTS) shard.on(event, closeIfRetired);
  }

  /** Deferred a tick so the shard's own ready wait settles first. */
  private closeLater(shard: GatewayShard): void {
    const done = nextTick()
      .then(() => shard.destroy(CLOSE))
      .catch(() => undefined);
    this.pending.add(done);
    void done.finally(() => this.pending.delete(done));
  }
}

/** Client options whose gateway strategy is tracked (see the header). */
export function withTrackedShards(options: ClientOptions): ClientOptions {
  return {
    ...options,
    ws: {
      ...options.ws,
      buildStrategy: (m) => new TrackingShardingStrategy(m),
    },
  };
}

/** The tracked strategy discord.js built for `client`, if it got that far. */
export function strategyOf(client: Client): TrackingShardingStrategy | null {
  const wsManager: unknown = Reflect.get(client.ws, '_ws');
  if (typeof wsManager !== 'object' || wsManager === null) return null;
  const strategy: unknown = Reflect.get(wsManager, 'strategy');
  return strategy instanceof TrackingShardingStrategy ? strategy : null;
}

/**
 * Close any gateway shard of `client` that discord.js's own destroy left
 * running. Returns how many were closed (0 when nothing lingered).
 */
export async function closeLingeringShards(client: Client): Promise<number> {
  return (await strategyOf(client)?.closeAll()) ?? 0;
}
