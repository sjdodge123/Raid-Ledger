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
