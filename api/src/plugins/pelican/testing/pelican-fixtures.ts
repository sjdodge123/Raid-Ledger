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
