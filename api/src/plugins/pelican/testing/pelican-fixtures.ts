import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type PelicanFixtureName =
  | 'servers-page'
  | 'server-resources'
  | 'server-schedules'
  | 'error-ip-not-allowed';

/** Parsed copy of an anonymised Pelican fixture (fresh object per call). */
export function loadPelicanFixture(name: PelicanFixtureName): unknown {
  const raw = readFileSync(join(__dirname, 'fixtures', `${name}.json`), 'utf8');
  const parsed: unknown = JSON.parse(raw);
  return parsed;
}

/** A JSON `Response` for a fake `fetch`. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Fake server `n` for page builders: uuid, identifier and name derive from n. */
export function fakeServer(n: number): {
  uuid: string;
  identifier: string;
  name: string;
} {
  const hex = n.toString(16).padStart(8, '0');
  return {
    uuid: `${hex}-0000-4000-8000-${hex.padStart(12, '0')}`,
    identifier: hex,
    name: `Fake Server ${n}`,
  };
}

/** A `GET /api/client` page body in Pelican's envelope. */
export function serverPageBody(
  servers: { uuid: string; identifier: string; name: string }[],
  currentPage: number,
  totalPages: number,
): unknown {
  return {
    object: 'list',
    data: servers.map((attributes) => ({ object: 'server', attributes })),
    meta: {
      pagination: {
        total: servers.length,
        count: servers.length,
        per_page: 100,
        current_page: currentPage,
        total_pages: totalPages,
      },
    },
  };
}

/** The URL a fake `fetch` was called with. */
export function requestUrl(input: Parameters<typeof fetch>[0]): URL {
  if (input instanceof URL) return input;
  return new URL(typeof input === 'string' ? input : input.url);
}

/** One task of a fake schedule (ROK-1773). `offset` is Pelican's `time_offset`. */
export interface FakeTaskSpec {
  action: string;
  payload: string | null;
  offset: number;
}

const FIXTURE_STAMP = '2025-12-01T12:00:00+00:00';

/**
 * A `server_schedule` list item in Pelican's envelope (ROK-1773). Tasks run
 * in the given order (`sequence_id` 1..n); task ids derive from the schedule id.
 */
export function fakeSchedule(
  id: number,
  tasks: FakeTaskSpec[],
  name = `Fake Schedule ${id}`,
): unknown {
  return {
    object: 'server_schedule',
    attributes: {
      id,
      name,
      cron: {
        day_of_week: '*',
        day_of_month: '*',
        month: '*',
        hour: '4',
        minute: '0',
      },
      is_active: true,
      is_processing: false,
      only_when_online: false,
      last_run_at: null,
      next_run_at: '2026-01-02T04:00:00+00:00',
      created_at: FIXTURE_STAMP,
      updated_at: FIXTURE_STAMP,
      relationships: {
        tasks: {
          object: 'list',
          data: tasks.map((t, i) => ({
            object: 'schedule_task',
            attributes: {
              id: id * 100 + i,
              sequence_id: i + 1,
              action: t.action,
              payload: t.payload,
              time_offset: t.offset,
              is_queued: false,
              continue_on_failure: false,
              created_at: FIXTURE_STAMP,
              updated_at: FIXTURE_STAMP,
            },
          })),
        },
      },
    },
  };
}

/** A `GET /servers/{id}/schedules` body wrapping `fakeSchedule` items. */
export function scheduleListBody(schedules: unknown[]): unknown {
  return { object: 'list', data: schedules };
}

/** A single-task power-restart schedule (the common fixture case). */
export function restartSchedule(id: number): unknown {
  return fakeSchedule(id, [{ action: 'power', payload: 'restart', offset: 0 }]);
}
