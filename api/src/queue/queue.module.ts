import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { QueueHealthService } from './queue-health.service';

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
        return {
          connection: {
            host: parsed.hostname,
            port: Number(parsed.port) || 6379,
            ...(parsed.password ? { password: parsed.password } : {}),
          },
          ...prefixOpt,
        };
      },
    }),
  ],
  providers: [QueueHealthService],
  exports: [BullModule, QueueHealthService],
})
export class QueueModule {}
