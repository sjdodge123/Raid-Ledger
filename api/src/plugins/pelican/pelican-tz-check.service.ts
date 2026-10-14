import { Injectable } from '@nestjs/common';
import { isValidIanaTimezone } from '@raid-ledger/contract';
import { PelicanConfigService } from './pelican-config.service';
import {
  PelicanSchedulesRepository,
  type PelicanActiveScheduleCron,
} from './pelican-schedules.repository';
import { hasTzMismatch } from './pelican-tz-check.helpers';

/** The server facts the check needs: its id and its own override. */
export interface TzCheckServer {
  id: number;
  timezone: string | null;
}

/**
 * Admin-row `tzMismatch` (ROK-1096 D11), computed on read — never persisted,
 * so a PATCH of the timezone override re-evaluates in its own response. One
 * query of the listed servers' active schedules + the plugin default tz.
 */
@Injectable()
export class PelicanTzCheckService {
  constructor(
    private readonly schedules: PelicanSchedulesRepository,
    private readonly config: PelicanConfigService,
  ) {}

  /** Ids of `servers` whose effective timezone mismatches their schedules. */
  async mismatchedServerIds(
    servers: readonly TzCheckServer[],
  ): Promise<Set<number>> {
    if (servers.length === 0) return new Set();
    const [rows, defaultTz] = await Promise.all([
      this.schedules.listActiveForServers(servers.map((s) => s.id)),
      this.config.resolveDefaultTimezone(),
    ]);
    const byServer = groupByServer(rows);
    const out = new Set<number>();
    for (const server of servers) {
      const tz = server.timezone ?? defaultTz;
      const group = byServer.get(server.id) ?? [];
      if (!isValidIanaTimezone(tz) || group.length === 0) continue;
      if (hasTzMismatch(group, tz)) out.add(server.id);
    }
    return out;
  }
}

function groupByServer(
  rows: readonly PelicanActiveScheduleCron[],
): Map<number, PelicanActiveScheduleCron[]> {
  const map = new Map<number, PelicanActiveScheduleCron[]>();
  for (const row of rows) {
    const group = map.get(row.serverId);
    if (group) group.push(row);
    else map.set(row.serverId, [row]);
  }
  return map;
}
