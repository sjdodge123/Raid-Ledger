import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import {
  resolveDatabaseUrl,
  type DatabaseUrlEnv,
} from '../config/database-url';
import * as schema from '../drizzle/schema';
import { InstancesRepository } from '../instances/instances.repository';

/** Runs `fn` with a repository on a one-connection client (L9, no Nest). */
export type RepoRunner = <T>(
  env: DatabaseUrlEnv,
  fn: (repo: InstancesRepository) => Promise<T>,
) => Promise<T>;

/** The real {@link RepoRunner}: always closes its client, even on error. */
export const withCliRepo: RepoRunner = async (env, fn) => {
  const sql = postgres(resolveDatabaseUrl(env), {
    max: 1,
    connect_timeout: 5,
    onnotice: () => undefined,
  });
  try {
    return await fn(new InstancesRepository(drizzle(sql, { schema })));
  } finally {
    await sql.end({ timeout: 5 });
  }
};
