/**
 * ROK-1459 (slice A) — AC6 / spec §5: palette drift guard.
 *
 * Architectural guard, in the style of `common/guards/cron-handlers.guard.spec.ts`.
 * Scans every non-spec `.ts` file under `api/src` and asserts:
 *   (a) nothing references the three deleted colour keys (LIVE_EVENT,
 *       PUG_INVITE, ROSTER_UPDATE) — every site is re-pointed to a state colour;
 *   (b) nothing bypasses the palette with a numeric `setColor(...)` literal;
 *   (c) `EMBED_COLORS` exposes exactly the five state colours;
 *   (d) nothing in `discord-bot/embeds/**` interpolates a raw Discord mention.
 *
 * Expected to FAIL until slice A lands: at time of writing there are 15
 * deleted-key references and 8 numeric setColor literals on origin/main.
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { EMBED_COLORS } from '../discord-bot.constants';

const SRC_DIR = join(__dirname, '..', '..');
const EMBEDS_DIR = __dirname;

/** Colour keys deleted by ROK-1459 — assembled so this file never self-matches. */
const DELETED_KEYS = [
  'LIVE_' + 'EVENT',
  'PUG_' + 'INVITE',
  'ROSTER_' + 'UPDATE',
];
const DELETED_KEY_RE = new RegExp(
  `EMBED_COLORS\\.(?:${DELETED_KEYS.join('|')})\\b`,
);
/**
 * `.setColor(0x34d399)` / `.setColor(3462041)` — a palette bypass. Scanned over
 * whole-file text with `s`+`g` so a literal wrapped onto the next line by
 * prettier is still caught (ROK-1459 review F6).
 */
const NUMERIC_SET_COLOR_RE = /\.setColor\(\s*(?:0[xX][0-9a-fA-F]+|\d+)/gs;
/** A bare 6-digit hex colour literal anywhere in the bot's source. */
const BARE_HEX_COLOR_RE = /0x[0-9a-fA-F]{6}\b/g;
/** The palette itself is the one place a hex colour literal belongs. */
const HEX_LITERAL_ALLOWLIST = ['discord-bot.constants.ts'];
/** Raw mention interpolation, e.g. `<@${userId}>`. */
const RAW_MENTION_RE = /<@\$\{/;

/** Recursively collect production `.ts` files (no specs, no helpers, no d.ts). */
function collectTsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'migrations')
        continue;
      results.push(...collectTsFiles(fullPath));
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.spec-helpers.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

/** Every `file:line — text` in `files` whose WHOLE-FILE text matches `re`. */
function scanWholeFile(files: string[], re: RegExp): string[] {
  const hits: string[] = [];
  for (const filePath of files) {
    const text = readFileSync(filePath, 'utf-8');
    for (const match of text.matchAll(re)) {
      const line = text.slice(0, match.index).split('\n').length;
      hits.push(
        `${relative(SRC_DIR, filePath)}:${line} — ${match[0].replace(/\s+/g, ' ')}`,
      );
    }
  }
  return hits;
}

/** Every `file:line — text` in `files` whose line matches `re`. */
function scan(files: string[], re: RegExp): string[] {
  const hits: string[] = [];
  for (const filePath of files) {
    const lines = readFileSync(filePath, 'utf-8').split('\n');
    lines.forEach((line, i) => {
      if (re.test(line)) {
        hits.push(`${relative(SRC_DIR, filePath)}:${i + 1} — ${line.trim()}`);
      }
    });
  }
  return hits;
}

describe('EMBED_COLORS palette guard (AC6)', () => {
  const files = collectTsFiles(SRC_DIR);

  it('finds source files to scan (sanity check on the walker)', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('no production code references a deleted colour key', () => {
    expect(scan(files, DELETED_KEY_RE)).toEqual([]);
  });

  it('no production code passes a numeric literal to setColor', () => {
    expect(scanWholeFile(files, NUMERIC_SET_COLOR_RE)).toEqual([]);
  });

  it('no bot source file hard-codes a hex colour outside the palette', () => {
    const botFiles = collectTsFiles(join(SRC_DIR, 'discord-bot')).filter(
      (f) => !HEX_LITERAL_ALLOWLIST.some((allowed) => f.endsWith(allowed)),
    );
    expect(scanWholeFile(botFiles, BARE_HEX_COLOR_RE)).toEqual([]);
  });

  it('exposes exactly the five state colours', () => {
    expect(Object.keys(EMBED_COLORS).sort()).toEqual([
      'ANNOUNCEMENT',
      'ERROR',
      'REMINDER',
      'SIGNUP_CONFIRMATION',
      'SYSTEM',
    ]);
  });
});

describe('shared embed module hygiene (spec §5c)', () => {
  it('never interpolates a raw Discord mention', () => {
    expect(scan(collectTsFiles(EMBEDS_DIR), RAW_MENTION_RE)).toEqual([]);
  });
});
