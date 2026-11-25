import { z } from 'zod';
import type {
  ApproveOutcome,
  InstancesRepository,
} from '../../instances/instances.repository';
import type { CliIo } from '../cli-io';

const MESSAGES: Record<ApproveOutcome, { ok: boolean; text: string }> = {
  approved: { ok: true, text: 'approved; its contributions now count' },
  already_approved: { ok: true, text: 'is already approved; nothing changed' },
  not_found: { ok: false, text: 'is not a registered instance' },
  revoked: { ok: false, text: 'is revoked and cannot be approved' },
  disconnected: { ok: false, text: 'is disconnected; it must re-register' },
};

/** `hub-admin approve <instanceId>` (AC 6): 0 on approve or no-op, else 1. */
export async function runApprove(
  repo: InstancesRepository,
  args: readonly string[],
  io: CliIo,
): Promise<number> {
  const id = args[0];
  if (!id) {
    io.err('hub-admin approve: missing <instanceId>');
    return 2;
  }
  if (!z.uuid().safeParse(id).success) {
    io.err(`hub-admin approve: ${id} is not an instance id (expected a UUID)`);
    return 1;
  }
  const { ok, text } = MESSAGES[await repo.approve(id)];
  const line = `Instance ${id} ${text}.`;
  if (ok) io.out(line);
  else io.err(line);
  return ok ? 0 : 1;
}
