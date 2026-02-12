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

        // Unix socket path (e.g. /tmp/redis.sock) vs TCP URL
        if (url.startsWith('/')) {
          return { connection: { path: url } };
        }

        const parsed = new URL(url);
        return {
          connection: {
            host: parsed.hostname,
            port: Number(parsed.port) || 6379,
            ...(parsed.password ? { password: parsed.password } : {}),
          },
        };
      },
    }),
  ],
  providers: [QueueHealthService],
  exports: [BullModule, QueueHealthService],
})
export class QueueModule {}
