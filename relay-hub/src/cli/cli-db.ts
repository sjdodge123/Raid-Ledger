import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import {
  resolveDatabaseUrl,
  type DatabaseUrlEnv,
} from '../config/database-url';
import * as schema from '../drizzle/schema';
import { InstancesRepository } from '../instances/instances.repository';

/** Runs `fn` with a one-connection postgres.js client (ROK-1674 crosswalk commands). */
export type SqlRunner = <T>(
  env: DatabaseUrlEnv,
  fn: (sql: Sql) => Promise<T>,
) => Promise<T>;

/** Runs `fn` with a repository on a one-connection client (L9, no Nest). */
export type RepoRunner = <T>(
  env: DatabaseUrlEnv,
  fn: (repo: InstancesRepository) => Promise<T>,
) => Promise<T>;

/** The real {@link SqlRunner}: always closes its client, even on error. */
export const withCliSql: SqlRunner = async (env, fn) => {
  const sql = postgres(resolveDatabaseUrl(env), {
    max: 1,
    connect_timeout: 5,
    onnotice: () => undefined,
  });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
};

/** The real {@link RepoRunner}, on top of {@link withCliSql}. */
export const withCliRepo: RepoRunner = (env, fn) =>
  withCliSql(env, (sql) =>
    fn(new InstancesRepository(drizzle(sql, { schema }))),
  );
