import { z } from 'zod';
import type {
  InstancesRepository,
  RevokeOutcome,
} from '../../instances/instances.repository';
import type { CliIo } from '../cli-io';

const USAGE = 'hub-admin revoke: usage: revoke <instanceId> --reason <text>';

const MESSAGES: Record<RevokeOutcome, { ok: boolean; text: string }> = {
  revoked: { ok: true, text: 'revoked' },
  already_revoked: { ok: true, text: 'is already revoked; nothing changed' },
  not_found: { ok: false, text: 'is not a registered instance' },
};

/**
 * `hub-admin revoke <instanceId> --reason <text>` (ROK-1672 AC 4): 0 on
 * revoke or no-op, 1 on an unknown/invalid id, 2 on bad usage. The reason is
 * stored, never printed.
 */
export async function runRevoke(
  repo: InstancesRepository,
  args: readonly string[],
  io: CliIo,
): Promise<number> {
  const id = args[0];
  const flag = args.indexOf('--reason');
  const reason = flag < 0 ? undefined : args[flag + 1]?.trim();
  if (!id || id.startsWith('--') || !reason) {
    io.err(USAGE);
    return 2;
  }
  if (!z.uuid().safeParse(id).success) {
    io.err(`hub-admin revoke: ${id} is not an instance id (expected a UUID)`);
    return 1;
  }
  const { ok, text } = MESSAGES[await repo.revoke(id, reason)];
  const line = `Instance ${id} ${text}.`;
  if (ok) io.out(line);
  else io.err(line);
  return ok ? 0 : 1;
}
