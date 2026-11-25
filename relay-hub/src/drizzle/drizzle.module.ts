import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { resolveDatabaseUrl } from '../config/database-url';
import * as schema from './schema';

/** postgres.js client (lazy: it connects on the first query). */
export const HUB_SQL = Symbol('HUB_SQL');
/** Drizzle database over {@link HUB_SQL}. */
export const HUB_DB = Symbol('HUB_DB');

export type HubDb = PostgresJsDatabase<typeof schema>;

function createSql(): Sql {
  return postgres(resolveDatabaseUrl(process.env), {
    max: 5,
    connect_timeout: 5,
    onnotice: () => undefined,
  });
}

@Global()
@Module({
  providers: [
    { provide: HUB_SQL, useFactory: createSql },
    {
      provide: HUB_DB,
      inject: [HUB_SQL],
      useFactory: (sql: Sql): HubDb => drizzle(sql, { schema }),
    },
  ],
  exports: [HUB_SQL, HUB_DB],
})
export class DrizzleModule implements OnModuleDestroy {
  constructor(@Inject(HUB_SQL) private readonly sql: Sql) {}

  async onModuleDestroy(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
