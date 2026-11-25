import { randomBytes } from 'crypto';
import postgres from 'postgres';

export interface TestDatabase {
  /** URL of the fresh, empty database. */
  readonly url: string;
  /** Drops the database and closes the admin connection. */
  drop(): Promise<void>;
}

/**
 * L10 (ROK-1670): a throwaway database per integration spec file, created on
 * the `DATABASE_URL` server, so migrate-from-empty starts pristine.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('relay-hub integration specs need DATABASE_URL');
  const name = `relayhub_it_${randomBytes(6).toString('hex')}`;
  const admin = postgres(base, { max: 1, onnotice: () => undefined });
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  const url = new URL(base);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    async drop(): Promise<void> {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.end({ timeout: 5 });
    },
  };
}
