import type {
  GameServerState,
  GameServerStatusDto,
} from '@raid-ledger/contract';
import type { PelicanServerRow } from '../../drizzle/schema';
import {
  PELICAN_PROVIDER_LABEL,
  PELICAN_STATUS_STALE_MS,
} from './pelican.constants';
import { redactServerName } from './pelican-name.helpers';

const PASS_THROUGH: ReadonlySet<string> = new Set([
  'running',
  'starting',
  'stopping',
  'offline',
]);

/** Admin-only view adds `suspended` (ruling Q8); members see `offline`. */
export type PelicanAdminState = GameServerState | 'suspended';

type StatusInput = Pick<
  PelicanServerRow,
  'currentState' | 'isSuspended' | 'statusCheckedAt'
>;

function isPassThrough(raw: string): raw is GameServerState {
  return PASS_THROUGH.has(raw);
}

function isStale(checkedAt: Date | null, now: Date): boolean {
  return (
    checkedAt === null ||
    now.getTime() - checkedAt.getTime() > PELICAN_STATUS_STALE_MS
  );
}

/** Admin state: stale → unknown, suspended → suspended, else the member state. */
export function toAdminServerState(
  row: StatusInput,
  now: Date,
): PelicanAdminState {
  if (isStale(row.statusCheckedAt, now)) return 'unknown';
  if (row.isSuspended) return 'suspended';
  const raw = row.currentState ?? '';
  return isPassThrough(raw) ? raw : 'unknown';
}

/** Member state (Q4/Q8): stale → unknown, suspended → offline. */
export function toGameServerState(
  row: StatusInput,
  now: Date,
): GameServerState {
  const state = toAdminServerState(row, now);
  return state === 'suspended' ? 'offline' : state;
}

/** Member-safe status DTO, or `null` for an unmapped / never-checked row. */
export function toStatusDto(
  row: PelicanServerRow,
  now: Date,
): GameServerStatusDto | null {
  if (row.gameId === null || row.statusCheckedAt === null) return null;
  return {
    serverKey: String(row.id),
    serverName: redactServerName(row.name, row.id),
    gameId: row.gameId,
    provider: PELICAN_PROVIDER_LABEL,
    state: toGameServerState(row, now),
    checkedAt: row.statusCheckedAt.toISOString(),
  };
}
