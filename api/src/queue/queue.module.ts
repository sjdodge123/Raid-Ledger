import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { Redis, type RedisOptions } from 'ioredis';
import { QueueHealthService } from './queue-health.service';

// ROK-1268: in integration tests (BULLMQ_KEY_PREFIX set) every spec boots
// AppModule, and each of the ~15 queues + ~16 workers opened its OWN ioredis
// base connection — ~46 sockets to redis PER spec file. Across the ~109-file
// `--runInBand` suite that cumulative loopback churn intermittently RSTs an
// unrelated fresh connect ("socket hang up" mid-suite). Sharing ONE base
// connection across all queues/workers drops it to ~16 (worker BLOCKING
// connections can't be shared). Prod leaves BULLMQ_KEY_PREFIX unset, so this
// path never runs — the production connection config is byte-for-byte unchanged.
let sharedTestConnection: Redis | undefined;

/**
 * Lazily create + return the single shared ioredis base connection used by
 * every BullMQ queue/worker in the integration test env. `maxRetriesPerRequest:
 * null` is REQUIRED — BullMQ throws at startup if a shared connection instance
 * lacks it. The bullmq key prefix stays in the bullmq `prefix` option (never as
 * an ioredis `keyPrefix`, which BullMQ rejects on a shared connection).
 */
export function getTestSharedRedis(options: RedisOptions): Redis {
  sharedTestConnection ??= new Redis({
    ...options,
    maxRetriesPerRequest: null,
  });
  return sharedTestConnection;
}

/** Quit + clear the shared test connection. Called from `closeTestApp`. */
export async function closeTestSharedRedis(): Promise<void> {
  const conn = sharedTestConnection;
  sharedTestConnection = undefined;
  if (!conn) return;
  try {
    await conn.quit();
  } catch {
    conn.disconnect();
  }
}

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('REDIS_URL', 'redis://localhost:6379');
        // ROK-1058: optional key prefix (e.g. `test-<pid>-<ts>-`) keeps
        // integration tests off the shared `bull:*` keyspace in dev/prod.
        // Production leaves this unset → BullMQ default prefix `bull` applies.
        // Read straight from process.env so per-suite re-exports take effect
        // without depending on ConfigModule's load order or expandVariables.
        const prefix = process.env.BULLMQ_KEY_PREFIX;
        const prefixOpt = prefix ? { prefix } : {};

        // Unix socket path (e.g. /tmp/redis.sock) vs TCP URL
        if (url.startsWith('/')) {
          return { connection: { path: url }, ...prefixOpt };
        }

        const parsed = new URL(url);
        const connection = {
          host: parsed.hostname,
          port: Number(parsed.port) || 6379,
          ...(parsed.password ? { password: parsed.password } : {}),
        };

        // ROK-1268: integration tests share ONE base connection (see top of
        // file); prod (no BULLMQ_KEY_PREFIX) uses per-queue config, unchanged.
        if (prefix) {
          return { connection: getTestSharedRedis(connection), ...prefixOpt };
        }
        return { connection, ...prefixOpt };
      },
    }),
  ],
  providers: [QueueHealthService],
  exports: [BullModule, QueueHealthService],
})
export class QueueModule {}
