import type { HubInstanceRow } from '../../drizzle/schema';
import type { InstancesRepository } from '../../instances/instances.repository';
import type { CliIo } from '../cli-io';

/** `--json` element: fixed key order, never the token hash (AC 5). */
export interface InstanceView {
  readonly instanceId: string;
  readonly status: string;
  readonly trustTier: string;
  readonly version: string;
  readonly registeredAt: string;
  readonly approvedAt: string | null;
  readonly lastHeartbeatAt: string | null;
}

export function toView(row: HubInstanceRow): InstanceView {
  return {
    instanceId: row.instanceId,
    status: row.status,
    trustTier: row.trustTier,
    version: row.version,
    registeredAt: row.registeredAt.toISOString(),
    approvedAt: row.approvedAt?.toISOString() ?? null,
    lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null,
  };
}

/** One human line: id, status, tier, version, registered, last heartbeat. */
export function formatLine(v: InstanceView): string {
  const heartbeat = v.lastHeartbeatAt ?? 'never';
  return `${v.instanceId}  ${v.status}  ${v.trustTier}  v${v.version}  registered ${v.registeredAt}  heartbeat ${heartbeat}`;
}

/** `hub-admin instances [--json]`. Rows arrive sorted by the repository. */
export async function runInstances(
  repo: InstancesRepository,
  args: readonly string[],
  io: CliIo,
): Promise<number> {
  const views = (await repo.list()).map(toView);
  if (args.includes('--json')) {
    io.out(JSON.stringify(views, null, 2));
  } else if (views.length === 0) {
    io.out('No instances registered.');
  } else {
    views.forEach((v) => io.out(formatLine(v)));
  }
  return 0;
}
