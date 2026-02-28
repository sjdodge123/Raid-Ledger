import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { isPerfEnabled } from '../common/perf-logger';
import { PerfDrizzleLogger } from './perf-drizzle-logger';

export const DrizzleAsyncProvider = 'drizzleProvider';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: DrizzleAsyncProvider,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const connectionString = configService.get<string>('DATABASE_URL');
        if (!connectionString) {
          throw new Error('DATABASE_URL is undefined');
        }
        const client = postgres(connectionString, {
          max: configService.get<number>('DB_POOL_MAX', 10),
          idle_timeout: configService.get<number>('DB_IDLE_TIMEOUT', 30),
        });
        const db = drizzle(client, {
          schema,
          logger: isPerfEnabled() ? new PerfDrizzleLogger() : undefined,
        });
        return db;
      },
    },
  ],
  exports: [DrizzleAsyncProvider],
})
export class DrizzleModule {}
