/**
 * ROK-1835 trust boundary R5: `users.steam_id` is written ONLY by
 * `UsersService.linkSteam` / `unlinkSteam` (via `users-steam-link.helpers.ts`, driven by the Steam OpenID link
 * flow in `steam-auth.controller.ts`). The Valheim armory auto-matches a
 * mod-asserted SteamID64 against that column, so any other writer would let
 * an unverified SteamID become an identity link. Seeds and test helpers are
 * allowed by path. Comments are stripped before scanning.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '..');
const ALLOWED = new Set([
  'users/users.service.ts',
  'users/users-steam-link.helpers.ts',
]);
const ALLOWED_PATH =
  /(^|\/)(testing|seeds?|test)\/|\.spec\.ts$|\.testing\.ts$|seed/;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === 'node_modules' ? [] : walk(full);
    return d.name.endsWith('.ts') ? [full] : [];
  });
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** True when the text writes users.steam_id via drizzle or raw SQL. */
export function writesUsersSteamId(text: string): boolean {
  const drizzle = /\.(?:update|insert)\(\s*(?:schema\.)?users\s*\)([^;]*)/g;
  for (const m of text.matchAll(drizzle)) {
    if (/\bsteamId\b/.test(m[1] ?? '')) return true;
  }
  return /\b(?:update\s+"?users"?\s+set|insert\s+into\s+"?users"?)[^;`]*steam_id/i.test(
    text,
  );
}

describe('users.steam_id writers (ROK-1835 R5)', () => {
  const writers = walk(SRC)
    .map((f) => path.relative(SRC, f).split(path.sep).join('/'))
    .filter((rel) =>
      writesUsersSteamId(
        stripComments(fs.readFileSync(path.join(SRC, rel), 'utf8')),
      ),
    );

  it('detects the legitimate writer (scanner is not vacuous)', () => {
    expect(writers).toContain('users/users-steam-link.helpers.ts');
  });

  it('has no writer outside the Steam link path, seeds and tests', () => {
    const offenders = writers.filter(
      (rel) => !ALLOWED.has(rel) && !ALLOWED_PATH.test(rel),
    );
    expect(offenders).toEqual([]);
  });

  it('flags a drizzle and a raw-SQL write in a sample', () => {
    expect(
      writesUsersSteamId('db.update(schema.users).set({ steamId: x });'),
    ).toBe(true);
    expect(writesUsersSteamId('sql`UPDATE users SET steam_id = 1`;')).toBe(
      true,
    );
    expect(
      writesUsersSteamId('db.update(schema.games).set({ steamId: x });'),
    ).toBe(false);
  });
});
