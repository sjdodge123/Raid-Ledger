/**
 * ROK-1733 boundary guard: WoW: Forever identity rules live in the WoW plugin
 * (api/src/plugins/wow-common), reached through the character-identity
 * extension point. Core characters code must not name Forever or its
 * rulesets — a new rule belongs in the plugin's identity provider.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = __dirname;

/** Forever-specific tokens; 'pvp'/'normal' are too generic to ban. */
const BANNED: readonly RegExp[] = [
  /forever/i,
  /['"`](roleplaying|hardcore)['"`]/,
];

/** Relative path -> reason. Keep empty: core has no Forever exceptions. */
const ALLOWLIST: Readonly<Record<string, string>> = {};

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) listSourceFiles(full, out);
    else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts'))
      out.push(full);
  }
  return out;
}

/** Block comments, then line comments — `://` in a URL is left alone. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

function offendingTokens(source: string): string[] {
  const stripped = stripComments(source);
  return BANNED.filter((re) => re.test(stripped)).map(String);
}

describe('characters core ↔ WoW plugin boundary (ROK-1733)', () => {
  it('stripper ignores a commented Forever but sees a coded one', () => {
    expect(
      offendingTokens('// WoW: Forever\n/* hardcore */ const a = 1;'),
    ).toEqual([]);
    expect(offendingTokens("const s = 'world-of-warcraft-forever';")).toEqual([
      '/forever/i',
    ]);
    expect(offendingTokens("const r = 'hardcore';")).toEqual([
      String(BANNED[1]),
    ]);
  });

  it('scans a non-empty set of core files', () => {
    expect(listSourceFiles(ROOT).length).toBeGreaterThan(5);
  });

  it('no core characters file names WoW: Forever or its rulesets', () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles(ROOT)) {
      const rel = relative(ROOT, file);
      if (ALLOWLIST[rel]) continue;
      const hits = offendingTokens(readFileSync(file, 'utf8'));
      if (hits.length) offenders.push(`${rel}: ${hits.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('every allowlist entry still matches (no stale exceptions)', () => {
    const stale = Object.keys(ALLOWLIST).filter(
      (rel) =>
        offendingTokens(readFileSync(join(ROOT, rel), 'utf8')).length === 0,
    );
    expect(stale).toEqual([]);
  });
});
