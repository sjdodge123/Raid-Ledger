import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

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
        const client = postgres(connectionString);
        const db = drizzle(client, { schema });
        return db;
      },
    },
  ],
  exports: [DrizzleAsyncProvider],
})
export class DrizzleModule {}
