/**
 * `hub-admin` (ROK-1671 L9): plain-argv operator CLI, no Nest bootstrap, so
 * `docker exec <hub> hub-admin …` works without the entrypoint's env.
 *
 *   hub-admin instances [--json]   list registered instances
 *   hub-admin approve <instanceId> approve a pending instance
 */
import type { InstancesRepository } from '../instances/instances.repository';
import { withCliRepo, type RepoRunner } from './cli-db';
import type { CliIo } from './cli-io';
import { runApprove } from './commands/approve.command';
import { runInstances } from './commands/instances.command';

type Command = (
  repo: InstancesRepository,
  args: readonly string[],
  io: CliIo,
) => Promise<number>;

const COMMANDS: Record<string, Command> = {
  instances: runInstances,
  approve: runApprove,
};

export const USAGE = [
  'Usage: hub-admin <command>',
  '  instances [--json]     list registered instances',
  '  approve <instanceId>   approve a pending instance',
].join('\n');

/** Runs one command; resolves to the process exit code. Never throws. */
export async function main(
  argv: readonly string[],
  io: CliIo,
  withRepo: RepoRunner = withCliRepo,
): Promise<number> {
  const [name, ...args] = argv;
  if (name === '--help' || name === '-h') {
    io.out(USAGE);
    return 0;
  }
  const command = name === undefined ? undefined : COMMANDS[name];
  if (!command) {
    io.err(USAGE);
    return 2;
  }
  try {
    return await withRepo(io.env, (repo) => command(repo, args, io));
  } catch (err) {
    io.err(
      `hub-admin ${name}: ${err instanceof Error ? err.message : 'failed'}`,
    );
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
