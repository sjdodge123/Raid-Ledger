import { readFileSync } from 'fs';

/** Reads a UTF-8 file, or returns undefined when it cannot be read. */
export type ReadTextFile = (filePath: string) => string | undefined;

/** The env keys the loader reads; a subset of `process.env`. */
export interface DatabaseUrlEnv {
  readonly DATABASE_URL?: string | undefined;
  readonly HUB_DATA_DIR?: string | undefined;
}

export function readTextFileOrUndefined(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

/** `${HUB_DATA_DIR:-/data}/secrets/db-password`. */
export function hubPasswordFile(env: DatabaseUrlEnv): string {
  const dataDir = env.HUB_DATA_DIR || '/data';
  return `${dataDir}/secrets/db-password`;
}

/**
 * The hub's Postgres URL (L8, §5.2 row 11). `DATABASE_URL` wins verbatim;
 * otherwise the embedded DB on 127.0.0.1 (never `localhost`) with the password
 * from the secrets file. Pure apart from the injected reader; the password is
 * never part of a thrown message.
 */
export function resolveDatabaseUrl(
  env: DatabaseUrlEnv,
  readFile: ReadTextFile = readTextFileOrUndefined,
): string {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const file = hubPasswordFile(env);
  const password = readFile(file)?.trim();
  if (password) {
    const encoded = encodeURIComponent(password);
    return `postgres://relayhub:${encoded}@127.0.0.1:5432/relayhub`;
  }
  throw new Error(
    `relay-hub database is not configured: set DATABASE_URL or create ${file}`,
  );
}
