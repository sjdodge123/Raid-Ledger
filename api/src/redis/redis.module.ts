import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

const RETRY_BASE_MS = 200;
const RETRY_CAP_MS = 5_000;

/** Exponential backoff: 200ms, 400ms, 600ms, ... capped at 5s */
export function retryStrategy(times: number): number {
  return Math.min(times * RETRY_BASE_MS, RETRY_CAP_MS);
}

/** Create a Redis client with error handling and reconnection. */
export function createRedisClient(url: string): Redis {
  const logger = new Logger('RedisModule');

  const base: RedisOptions = {
    retryStrategy,
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  };

  const opts: RedisOptions = url.startsWith('/')
    ? { ...base, path: url }
    : { ...base };

  const client = url.startsWith('/') ? new Redis(opts) : new Redis(url, opts);

  client.on('error', (err: Error) => {
    logger.error(`Redis error: ${err.message}`);
  });
  client.on('connect', () => {
    logger.debug('Redis connected');
  });
  client.on('close', () => {
    logger.warn('Redis connection closed');
  });

  return client;
}

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
        return createRedisClient(url);
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
