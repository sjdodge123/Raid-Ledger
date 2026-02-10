import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * Global Redis module for caching and rate limit tracking.
 * Used by IGDB service for search result caching (ROK-161).
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const url = configService.get<string>(
          'REDIS_URL',
          'redis://localhost:6379',
        );
        // Unix socket path (e.g. /tmp/redis.sock) vs TCP URL
        return url.startsWith('/') ? new Redis({ path: url }) : new Redis(url);
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
