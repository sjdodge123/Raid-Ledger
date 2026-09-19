/**
 * ROK-1627 AC1 — the bootstrap must never derive `CLIENT_URL` from a request.
 *
 * `installAutoClientUrlDetection` used to write process-wide state from the
 * `Host` header of the first non-localhost request, so a forged header
 * hijacked every later auth redirect. This guard fails if anything of that
 * shape comes back to `main.ts`.
 *
 * Comments are stripped before scanning — this file's own prose names the
 * tokens it forbids, and a naive scan trips on itself (ROK-1314, twice).
 */
import { readFileSync } from 'fs';
import { join } from 'path';

/** Strip block and line comments before scanning. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const mainSource = stripComments(
  readFileSync(join(__dirname, 'main.ts'), 'utf8'),
);

describe('main.ts request-derived CLIENT_URL guard', () => {
  it('never assigns process.env.CLIENT_URL', () => {
    expect(mainSource).not.toMatch(/process\.env\.CLIENT_URL\s*=[^=]/);
  });

  it('never reads the request Host or forwarded-proto headers', () => {
    expect(mainSource).not.toMatch(/headers\.host/);
    expect(mainSource).not.toMatch(/x-forwarded-proto/i);
  });

  it('no longer installs the auto client-url detection middleware', () => {
    expect(mainSource).not.toMatch(/installAutoClientUrlDetection/);
  });
});
