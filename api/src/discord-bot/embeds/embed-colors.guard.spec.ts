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
import { defined } from '../../common/testing/narrow';

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
 * COMMENT-STRIPPED whole-file text with `s`+`g`: a literal wrapped onto the
 * next line by prettier is still caught (ROK-1459 review F6), while a comment
 * that merely names one cannot trip the guard.
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

/**
 * Every `relPath:line — text` where `re` matches `text` as a WHOLE, so one
 * match may span lines; the line is where the match starts. `matchAll` needs a
 * GLOBAL regex.
 */
function wholeTextHits(text: string, relPath: string, re: RegExp): string[] {
  return [...text.matchAll(re)].map((match) => {
    const line = text.slice(0, match.index).split('\n').length;
    return `${relPath}:${line} — ${match[0].replace(/\s+/g, ' ')}`;
  });
}

/** How the scanners read a file; a parameter so the proofs can feed fixtures. */
type ReadSource = (filePath: string) => string;
const readSource: ReadSource = (filePath) => readFileSync(filePath, 'utf-8');

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

/*
 * Literal and comment patterns for `stripComments`. Quote characters are
 * written as `\x27` / `\x22` / `\x60` so these sources hold no raw quote that
 * the stripper, run over this very file, could misread.
 *
 * A regex literal is recognised only where one can start (after an operator,
 * an opening bracket, a keyword or a line start), which tells it apart from
 * division.
 */
const REGEX_LITERAL = String.raw`(?<=(?:^|[(,=:[!&|?{};]|\b(?:return|typeof|case|throw|await|yield|void|delete))\s*)\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/[dgimsuyv]*`;
const QUOTED_STRING = String.raw`\x27(?:\\.|[^\x27\\\n])*\x27|\x22(?:\\.|[^\x22\\\n])*\x22`;
const TEMPLATE_LITERAL = String.raw`\x60(?:\\.|\$\{(?:[^{}\x60]|\x60(?:\\.|[^\x60\\])*\x60)*\}|[^\x60\\])*\x60`;
const COMMENT = String.raw`(\/\*[\s\S]*?\*\/|\/\/[^\n]*)`;
const LITERAL_OR_COMMENT_RE = new RegExp(
  [REGEX_LITERAL, QUOTED_STRING, TEMPLATE_LITERAL, COMMENT].join('|'),
  'gm',
);

/**
 * Blank out block and line comments, PRESERVING line and column positions so
 * a hit still reports the file:line a human can jump to.
 *
 * One left-to-right pass that consumes string, template and regex literals
 * whole and keeps them verbatim, so a comment marker inside one (a URL in a
 * string, an escaped slash pair in a regex) can no longer open a "comment"
 * that blanks real code. Keeping literals is also the safe direction: a
 * forbidden token inside a string is over-reported, never hidden. When
 * written, the output matched TypeScript's own comment ranges on every `.ts`
 * file under `api/src`.
 */
function stripComments(source: string): string {
  return source.replace(
    LITERAL_OR_COMMENT_RE,
    (match: string, comment: string | undefined) =>
      comment === undefined ? match : comment.replace(/[^\n]/g, ' '),
  );
}

/** The ROK-1446 `channel-presence*.ts` sources (D14). */
function channelPresenceFiles(): string[] {
  return collectTsFiles(PRESENCE_DIR).filter((file) =>
    PRESENCE_FILE_RE.test(file),
  );
}

/**
 * `wholeTextHits` over each file's COMMENT-STRIPPED text. Whole-file rather
 * than per-line so a prettier-wrapped call is still one match; stripped so
 * prose that names a forbidden literal is not one. Pass a GLOBAL regex.
 */
function scanWholeFileStripped(
  files: string[],
  re: RegExp,
  read: ReadSource = readSource,
): string[] {
  return files.flatMap((filePath) =>
    wholeTextHits(
      stripComments(read(filePath)),
      relative(SRC_DIR, filePath),
      re,
    ),
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
    expect(scanWholeFileStripped(files, NUMERIC_SET_COLOR_RE)).toEqual([]);
  });

  it('no bot source file hard-codes a hex colour outside the palette', () => {
    const botFiles = collectTsFiles(join(SRC_DIR, 'discord-bot')).filter(
      (f) => !HEX_LITERAL_ALLOWLIST.some((allowed) => f.endsWith(allowed)),
    );
    expect(scanWholeFileStripped(botFiles, BARE_HEX_COLOR_RE)).toEqual([]);
  });

  // Both whole-file scans once ran over RAW text, so a comment naming a
  // literal turned them red. The fixture path never touches disk: `read` is
  // stubbed, and spec files are outside the walk, so these strings are inert.
  const FIXTURE = join(SRC_DIR, 'fixture.ts');
  const scanFixture = (source: string, re: RegExp) =>
    scanWholeFileStripped([FIXTURE], re, () => source);

  it('ignores palette literals that appear only in comments', () => {
    const source =
      '/* legacy 0xdeadbe and .setColor(0x34d399) */\n' +
      '// .setColor(0x123456)\nconst x = 1;';
    // Control: over RAW text (the old scan) the same fixture trips both.
    const raw = (re: RegExp) => wholeTextHits(source, 'fixture.ts', re);
    expect(raw(NUMERIC_SET_COLOR_RE)).toHaveLength(2);
    expect(raw(BARE_HEX_COLOR_RE)).toHaveLength(3);
    expect(scanFixture(source, NUMERIC_SET_COLOR_RE)).toEqual([]);
    expect(scanFixture(source, BARE_HEX_COLOR_RE)).toEqual([]);
  });

  // A comment marker inside a string or regex literal, or a `/*` inside a line
  // comment, once opened a phantom comment that blanked the real code after it.
  it('never lets a comment marker inside a literal or line comment hide code', () => {
    const source =
      '// see /x/*\nembed.setColor(0x111111);\n' +
      "const s = 'a//b'; embed.setColor(0x222222);\n" +
      'const r = /^https?:\\/\\//; embed.setColor(0x333333);\n// */';
    expect(scanFixture(source, NUMERIC_SET_COLOR_RE)).toEqual([
      'fixture.ts:2 — .setColor(0x111111',
      'fixture.ts:3 — .setColor(0x222222',
      'fixture.ts:4 — .setColor(0x333333',
    ]);
  });

  it('still catches a numeric setColor that prettier wrapped onto a new line', () => {
    const source = 'embed.setColor(\n  0x123456,\n);';
    expect(scanFixture(source, NUMERIC_SET_COLOR_RE)).toEqual([
      'fixture.ts:1 — .setColor( 0x123456',
    ]);
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

/**
 * ROK-1479 D9 (spec Lane C) — the timestamp-markup slot ledger, enforced.
 *
 * Discord renders `<t:EPOCH:style>` in an embed's DESCRIPTION and field values
 * but NOT in its author line or footer, and `assertNoTimestampMarkup`
 * (`embed-chrome.helpers.ts`) THROWS when the markup reaches either. That
 * runtime guard fires on a real post; this one fires in CI, on the source.
 *
 * The scan is TRANSITIVE, because the defect is: a slot builder starts calling
 * a helper that formats the markup. Scanning only the two builders' own bodies
 * would miss exactly that. So it walks `authorLine` / `footerLabel` plus every
 * locally-declared function they reach, and asserts the needle appears nowhere
 * in that closure — while `nowExpiryMarkup` (the DESCRIPTION's formatter, which
 * legitimately contains it) must stay OUTSIDE the closure for the scan to mean
 * anything. Both facts are pinned below.
 *
 * Comments are STRIPPED first and the needle is ASSEMBLED from fragments:
 * `footerLabel`'s own body explains in prose why it withholds the markup, and
 * a naive scan trips on that sentence — the ROK-1314 self-match defect, twice.
 * Sentinel for the stripper self-check below: ROK-1479-D9.
 */
const TIMESTAMP_MARKUP = '<t' + ':';
/** The two chrome slots that cannot render the markup. */
const CHROME_SLOT_FNS = ['author' + 'Line', 'footer' + 'Label'];
const LFM_EMBED_FILE_RE = /(^|[\\/])lfm-embed[^\\/]*\.ts$/;

/** The `function <name>(…) { … }` text in `source`, brace-matched, or null. */
function functionBody(source: string, name: string): string | null {
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) return null;
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

/** `roots` plus every locally-declared function they transitively call. */
function callClosure(source: string, roots: string[]): Map<string, string> {
  const local = [...source.matchAll(/function\s+(\w+)\s*\(/g)].map((m) =>
    defined(m[1], 'function name'),
  );
  const found = new Map<string, string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const name = queue.shift() as string;
    if (found.has(name)) continue;
    const body = functionBody(source, name);
    if (!body) continue;
    found.set(name, body);
    for (const callee of local) {
      if (callee !== name && new RegExp(`\\b${callee}\\s*\\(`).test(body)) {
        queue.push(callee);
      }
    }
  }
  return found;
}

describe('ROK-1479 D9 — no timestamp markup reaches an author line or footer', () => {
  const lfmFiles = collectTsFiles(join(SRC_DIR, 'discord-bot', 'lfm')).filter(
    (file) => LFM_EMBED_FILE_RE.test(file),
  );
  const helpersFile = lfmFiles.find((file) =>
    file.endsWith('lfm-embed.helpers.ts'),
  );

  // Three ways this guard could pass vacuously: an empty file set, a closure
  // that resolves neither root, or a closure so greedy it swallows the whole
  // file (at which point a red run would say nothing about the two slots).
  it('finds the slot builders it is supposed to be guarding', () => {
    expect(lfmFiles.length).toBeGreaterThanOrEqual(4);
    expect(helpersFile).toBeDefined();
    const source = stripComments(readFileSync(helpersFile as string, 'utf-8'));
    const names = [...callClosure(source, CHROME_SLOT_FNS).keys()];
    // Both roots resolve, and the walk is transitive: `stateAuthorLine` is
    // reachable ONLY through `authorLine`.
    expect(names).toEqual(
      expect.arrayContaining([...CHROME_SLOT_FNS, 'state' + 'AuthorLine']),
    );
    // ...and the description's markup formatter is genuinely outside it.
    expect(names).not.toContain('now' + 'ExpiryMarkup');
  });

  it('no string reaching those slots carries the markup', () => {
    const hits: string[] = [];
    for (const filePath of lfmFiles) {
      const source = stripComments(readFileSync(filePath, 'utf-8'));
      for (const [name, body] of callClosure(source, CHROME_SLOT_FNS)) {
        if (body.includes(TIMESTAMP_MARKUP)) {
          hits.push(`${relative(SRC_DIR, filePath)} — ${name}()`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it('proves the comment-stripper on this very file', () => {
    const self = readFileSync(join(__dirname, SELF_FILENAME), 'utf-8');
    const sentinel = ['ROK', '1479', 'D9'].join('-');

    expect(self).toContain(sentinel);
    expect(stripComments(self)).not.toContain(sentinel);
    expect(stripComments(self)).toContain('CHROME_SLOT_FNS');
  });
});
