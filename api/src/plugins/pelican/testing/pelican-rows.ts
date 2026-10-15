import type { PelicanServerRow } from '../../../drizzle/schema';
import { fakeServer } from './pelican-fixtures';

/** A polled `pelican_servers` row for unit specs (mapped, visible, present). */
export function pelicanRow(
  n: number,
  overrides: Partial<PelicanServerRow> = {},
): PelicanServerRow {
  const s = fakeServer(n);
  return {
    id: n,
    panelUuid: s.uuid,
    identifier: s.identifier,
    name: s.name,
    gameId: 7,
    showOnCalendar: true,
    timezone: null, // ROK-1795: column unread; dropped in a follow-up
    currentState: 'running',
    isSuspended: false,
    statusCheckedAt: null,
    lastSyncedAt: new Date('2026-10-13T00:00:00Z'),
    missingSince: null,
    ...overrides,
  };
}
