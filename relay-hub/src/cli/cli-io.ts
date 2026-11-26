import type { DatabaseUrlEnv } from '../config/database-url';

/** Where `hub-admin` writes and which env it reads (injected in specs). */
export interface CliIo {
  readonly env: DatabaseUrlEnv;
  out(line: string): void;
  err(line: string): void;
}
