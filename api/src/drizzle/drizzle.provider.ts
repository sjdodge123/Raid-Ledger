import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export const DrizzleAsyncProvider = 'drizzleProvider';

import { ConfigService } from '@nestjs/config';

export const drizzleProvider = [
  {
    provide: DrizzleAsyncProvider,
    inject: [ConfigService],
    useFactory: async (configService: ConfigService) => {
      const connectionString = configService.get<string>('DATABASE_URL')!;
      const client = postgres(connectionString);
      const db = drizzle(client, { schema });
      return db;
    },
  },
];
