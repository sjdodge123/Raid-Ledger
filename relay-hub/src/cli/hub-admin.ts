/**
 * `hub-admin` (ROK-1671 L9): plain-argv operator CLI, no Nest bootstrap, so
 * `docker exec <hub> hub-admin …` works without the entrypoint's env.
 *
 *   hub-admin instances [--json]   list registered instances
 *   hub-admin approve <instanceId> approve a pending instance
 *   hub-admin revoke <instanceId> --reason <text>  revoke an instance
 *   hub-admin stats [--json]       crosswalk counts (ROK-1674)
 *   hub-admin lookup --kind <k> --value <v>  one game and its ids
 *   hub-admin conflicts [--all] [--json]     crosswalk conflicts
 */
import type { Sql } from 'postgres';
import { DrizzleQueryError } from 'drizzle-orm';
import type { InstancesRepository } from '../instances/instances.repository';
import {
  withCliRepo,
  withCliSql,
  type RepoRunner,
  type SqlRunner,
} from './cli-db';
import type { CliIo } from './cli-io';
import { runApprove } from './commands/approve.command';
import { runConflicts } from './commands/conflicts.command';
import { runLookup } from './commands/lookup.command';
import { runStats } from './commands/stats.command';
import { runInstances } from './commands/instances.command';
import { runRevoke } from './commands/revoke.command';

type Command = (
  repo: InstancesRepository,
  args: readonly string[],
  io: CliIo,
) => Promise<number>;

const COMMANDS: Record<string, Command> = {
  instances: runInstances,
  approve: runApprove,
  revoke: runRevoke,
};

type SqlCommand = (
  sql: Sql,
  args: readonly string[],
  io: CliIo,
) => Promise<number>;

/** Read-only crosswalk commands on a raw client (ROK-1674 L7). */
const SQL_COMMANDS: Record<string, SqlCommand> = {
  stats: runStats,
  lookup: runLookup,
  conflicts: runConflicts,
};

export const USAGE = [
  'Usage: hub-admin <command>',
  '  instances [--json]     list registered instances',
  '  approve <instanceId>   approve a pending instance',
  '  revoke <instanceId> --reason <text>   revoke an instance',
  '  stats [--json]         crosswalk counts per kind, source, provenance',
  '  lookup --kind <kind> --value <value>   one game and its ids',
  '  conflicts [--all] [--json]   crosswalk conflicts (open only by default)',
].join('\n');

const ERROR_CODE = /^[A-Z0-9_]{1,32}$/;

/**
 * The stderr text for a failed command. A query error's message carries its
 * params (e.g. a revoke reason), so it is reduced to a generic line plus the
 * driver's error code (SQLSTATE / ECONNREFUSED) when there is one.
 */
export function describeFailure(err: unknown): string {
  if (!(err instanceof DrizzleQueryError)) {
    return err instanceof Error ? err.message : 'failed';
  }
  const cause: unknown = err.cause;
  const code =
    cause instanceof Error && 'code' in cause ? cause.code : undefined;
  return typeof code === 'string' && ERROR_CODE.test(code)
    ? `database query failed (${code})`
    : 'database query failed';
}

/** The bound command for `name`, or undefined when there is none. */
function resolveCommand(
  name: string | undefined,
  args: readonly string[],
  io: CliIo,
  runners: { readonly repo: RepoRunner; readonly sql: SqlRunner },
): (() => Promise<number>) | undefined {
  if (name === undefined) return undefined;
  const repoCommand = COMMANDS[name];
  if (repoCommand) {
    return () => runners.repo(io.env, (repo) => repoCommand(repo, args, io));
  }
  const sqlCommand = SQL_COMMANDS[name];
  if (sqlCommand) {
    return () => runners.sql(io.env, (sql) => sqlCommand(sql, args, io));
  }
  return undefined;
}

/** Runs one command; resolves to the process exit code. Never throws. */
export async function main(
  argv: readonly string[],
  io: CliIo,
  withRepo: RepoRunner = withCliRepo,
  withSql: SqlRunner = withCliSql,
): Promise<number> {
  const [name, ...args] = argv;
  if (name === '--help' || name === '-h') {
    io.out(USAGE);
    return 0;
  }
  const command = resolveCommand(name, args, io, {
    repo: withRepo,
    sql: withSql,
  });
  if (!command) {
    io.err(USAGE);
    return 2;
  }
  try {
    return await command();
  } catch (err) {
    io.err(`hub-admin ${name}: ${describeFailure(err)}`);
    return 1;
  }
}

if (require.main === module) {
  const io: CliIo = {
    env: process.env,
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  };
  void main(process.argv.slice(2), io).then((code) => {
    process.exitCode = code;
  });
}
