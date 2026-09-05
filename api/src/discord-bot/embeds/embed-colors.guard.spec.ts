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
 * ROK-1446 D14 extends (d) and adds (e): the channel presence embed's sources
 * live in `discord-bot/services/channel-presence*.ts`, OUTSIDE the walk above,
 * so nothing structurally stopped a `<@id>` mention leaking into a roster --
 * and "bold plain names, never mentions" is the design's first trap. Those
 * files are also forbidden the three chrome setters `createChannelEmbed` owns.
 * Sentinel for the stripper self-check below: ROK-1446-D14.
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

/**
 * ROK-1446 D14 — the presence sources, which live under `discord-bot/services/`
 * rather than `discord-bot/embeds/`.
 *
 * `setTitle` is deliberately absent from the setter list: D2 overrides the
 * title to the Just Chatting label for the null-game group, and that override
 * is approved.
 *
 * The setter names are ASSEMBLED (the `LIVE_` + `EVENT` idiom already used for
 * the deleted colour keys above) so this spec file can never self-match, and
 * the scans below run over COMMENT-STRIPPED text so a presence file's own
 * prose cannot trip its guard -- that false positive has fired twice on this
 * repo (ROK-1314).
 */
const CHROME_SETTERS = ['set' + 'Color', 'set' + 'Author', 'set' + 'Footer'];
const PRESENCE_DIR = join(SRC_DIR, 'discord-bot', 'services');
const PRESENCE_FILE_RE = /(^|[\\/])channel-presence[^\\/]*\.ts$/;

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

/**
 * Blank out block and line comments, PRESERVING line numbers so a hit still
 * reports the file:line a human can jump to.
 *
 * String literals are deliberately left in: stripping them needs a scanner
 * that also understands regex literals, and over-reporting a forbidden token
 * inside a string is the safe direction to err. Same reasoning as
 * `personalized-surface.guard.spec.ts`; this variant additionally keeps line
 * numbers stable by replacing a block comment with spaces rather than nothing.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_match, prefix: string) => prefix);
}

/** The ROK-1446 `channel-presence*.ts` sources (D14). */
function channelPresenceFiles(): string[] {
  return collectTsFiles(PRESENCE_DIR).filter((file) =>
    PRESENCE_FILE_RE.test(file),
  );
}

/** `scan`, but over comment-stripped text. Pass a NON-global regex. */
function scanStripped(files: string[], re: RegExp): string[] {
  const hits: string[] = [];
  for (const filePath of files) {
    const lines = stripComments(readFileSync(filePath, 'utf-8')).split('\n');
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

describe('ROK-1446 D14 — channel-presence sources own no chrome', () => {
  const presenceFiles = channelPresenceFiles();

  // A source-scanning guard whose glob matches nothing passes forever. Pin the
  // two files that exist at the time of writing so a rename or a move of the
  // directory turns into a red test rather than silent zero coverage.
  it('the channel-presence glob actually reaches files', () => {
    expect(presenceFiles.map((file) => relative(SRC_DIR, file))).toEqual(
      expect.arrayContaining([
        'discord-bot/services/channel-presence-embed.service.ts',
        'discord-bot/services/channel-presence-room.helpers.ts',
      ]),
    );
  });

  it.each(CHROME_SETTERS)('never calls .%s (chrome owns it)', (setter) => {
    const re = new RegExp(`\\.${setter}\\s*\\(`);
    expect(scanStripped(presenceFiles, re)).toEqual([]);
  });

  it('never interpolates a raw Discord mention (rosters are bold plain names)', () => {
    expect(scanStripped(presenceFiles, RAW_MENTION_RE)).toEqual([]);
  });

  // The stripper is load-bearing for every scan above, so prove it on the
  // hardest input available: this file, whose own prose names the tokens it
  // forbids. The sentinel is assembled at runtime, so its literal form exists
  // ONLY in the header comment -- spelling it out here would make the
  // assertion pass for the wrong reason.
  it('proves the comment-stripper on this very file', () => {
    const self = readFileSync(join(__dirname, SELF_FILENAME), 'utf-8');
    const sentinel = ['ROK', '1446', 'D14'].join('-');

    expect(self).toContain(sentinel);
    expect(stripComments(self)).not.toContain(sentinel);
    expect(stripComments(self)).toContain('CHROME_SETTERS');
    // Line numbers must survive stripping, or every hit points at the wrong line.
    expect(stripComments(self).split('\n')).toHaveLength(
      self.split('\n').length,
    );
  });
});

/** This spec's own filename, so the self-check cannot go stale on a rename. */
const SELF_FILENAME = 'embed-colors.guard.spec.ts';

/**
 * ROK-1454 D13 — the LFM/LFG families never touch colour at all.
 *
 * `createChannelEmbed` owns the colour bar; a `.setColor(` anywhere under
 * `discord-bot/lfm/**` or on `discord-bot/commands/lfg*.ts` means someone
 * bypassed the chrome. Stricter than the palette guard above: not "no numeric
 * literal", but no call at all.
 *
 * Comments are STRIPPED before matching. `lfm-embed.helpers.ts` documents in
 * prose that it never calls `.setColor`, and a naive scan trips on that
 * sentence — the exact self-match defect that landed twice in ROK-1314.
 */
const SET_COLOR_CALL_RE = /\.setColor\s*\(/g;

describe('LFM / LFG families delegate colour to the chrome (ROK-1454 D13)', () => {
  // ROK-1471 D14b: the forum surface builds its own embeds and component rows,
  // so it joins the walk — `createChannelEmbed` still owns the colour bar.
  const boardFiles = collectTsFiles(join(SRC_DIR, 'discord-bot', 'lfg-board'));
  const chromeOwnedFiles = [
    ...collectTsFiles(join(SRC_DIR, 'discord-bot', 'lfm')),
    ...boardFiles,
    ...collectTsFiles(join(SRC_DIR, 'discord-bot', 'commands')).filter((f) =>
      /\/lfg[^/]*\.ts$/.test(f),
    ),
  ];

  it('finds the files it is supposed to be guarding', () => {
    // Without this the suite passes vacuously the moment the walker breaks or
    // the directory is renamed. Seven production files at ROK-1454 merge.
    expect(chromeOwnedFiles.length).toBeGreaterThanOrEqual(7);
    // D14b: and the ROK-1471 forum family is genuinely inside the walk, not
    // merely adjacent to it — dropping the directory must go red here.
    expect(boardFiles.length).toBeGreaterThanOrEqual(9);
    expect(chromeOwnedFiles).toEqual(expect.arrayContaining(boardFiles));
  });

  it('never calls setColor — the chrome chooses the colour', () => {
    const hits: string[] = [];
    for (const filePath of chromeOwnedFiles) {
      const stripped = stripComments(readFileSync(filePath, 'utf-8'));
      for (const match of stripped.matchAll(SET_COLOR_CALL_RE)) {
        const line = stripped.slice(0, match.index).split('\n').length;
        hits.push(`${relative(SRC_DIR, filePath)}:${line}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

/**
 * ROK-1477 AC3 (spec §5a) — palette MISUSE, expressed as a property.
 *
 * The one-sentence property this story buys: the colour palette is named by
 * exactly two production files — the one that DEFINES it and the one that
 * turns a state into a colour. Everything else asks the chrome for a state and
 * gets a colour as a consequence, which is what "colour derives from state"
 * means in enforceable terms.
 *
 * This is deliberately a property with a two-file allowlist rather than an
 * enumeration of what has been migrated: a list of finished files ratifies a
 * partial migration and goes green forever, which is the exact defect this
 * story exists to correct. A property fails the moment a sixteenth file
 * reaches for the palette again.
 *
 * The token is ASSEMBLED (the `LIVE_` + `EVENT` idiom above) so this spec —
 * which imports the palette itself, two lines from the top — can never
 * self-match. Scans run over COMMENT-STRIPPED text for the same reason.
 * Sentinel for the stripper self-check below: ROK-1477-AC3.
 */
const PALETTE_TOKEN_RE = new RegExp(
  String.raw`\b${['EMBED', 'COLORS'].join('_')}\s*\.`,
);
/**
 * The two files allowed to name the palette. The definer is listed for
 * completeness — its `EMBED_COLORS = {` never matches the `EMBED_COLORS.`
 * token today, so the entry does no filtering work until someone references
 * the palette inside that file.
 */
const PALETTE_ALLOWLIST = [
  // Defines the palette.
  'discord-bot/discord-bot.constants.ts',
  // STATE_COLORS — the only production map from a state to a colour.
  'discord-bot/embeds/embed-chrome.helpers.ts',
];

describe('ROK-1477 AC3 — only the palette and the chrome name EMBED_COLORS', () => {
  const files = collectTsFiles(SRC_DIR);
  const guardedFiles = files.filter(
    (file) => !PALETTE_ALLOWLIST.some((allowed) => file.endsWith(allowed)),
  );

  // Two ways this guard could pass vacuously: a broken walker (empty scan set)
  // or an allowlist pointing at files that have since moved (which would make
  // the filter above a no-op AND hide a real reference behind a stale path).
  it('finds the files it is supposed to be guarding', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(
      PALETTE_ALLOWLIST.every((allowed) =>
        files.some((file) => file.endsWith(allowed)),
      ),
    ).toBe(true);
  });

  it('no other production file reaches for the palette directly', () => {
    expect(scanStripped(guardedFiles, PALETTE_TOKEN_RE)).toEqual([]);
  });

  // The stripper is load-bearing for the scan above: this file's own prose
  // names the token it forbids. Sentinel assembled at runtime so its literal
  // form exists ONLY in the header comment.
  it('proves the comment-stripper on this very file', () => {
    const self = readFileSync(join(__dirname, SELF_FILENAME), 'utf-8');
    const sentinel = ['ROK', '1477', 'AC3'].join('-');

    expect(self).toContain(sentinel);
    expect(stripComments(self)).not.toContain(sentinel);
    expect(stripComments(self)).toContain('PALETTE_ALLOWLIST');
  });
});
