import * as fs from 'fs';
import * as path from 'path';

/**
 * ROK-1471 D14a / AC15 — no hardcoded Discord permission integer in source.
 *
 * The invite URL and the permission check both derive their bitfield from
 * `REQUIRED_PERMISSIONS`. A pasted integer (the invite URL's `permissions=`
 * value is 15 digits) silently decouples the two: the check would report the
 * new permission as required while the install link kept asking for the old
 * set. This guard fails the build on any 12-or-more-digit literal in the
 * surfaces that could carry one.
 *
 * Comments are stripped BEFORE matching (ROK-1314: a guard whose own
 * explanatory prose trips it is a guard that gets deleted). Test files are out
 * of scope on purpose — the assertions in
 * `discord-bot-client.helpers.spec.ts` are exactly where the expected integer
 * SHOULD be written down.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/** Directories scanned recursively, relative to the repo root. */
const SCANNED_DIRS = [
  'api/src/discord-bot',
  'web/src/components/admin',
  'web/src/pages/admin',
  'packages/contract/src',
];

/** Individual files scanned, relative to the repo root. */
const SCANNED_FILES = ['README.md'];

/**
 * Files permitted to hold a 12+ digit literal, with the reason.
 * Empty by design: add an entry ONLY for a genuine snowflake/id constant.
 */
const ALLOWLIST: { file: string; why: string }[] = [];

const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.md'];
// `n?` catches a BigInt literal (`589674583247891n`) and `[\d_]` catches
// numeric separators — both are how a permission constant would actually be
// pasted into TypeScript, and a bare /\b\d{12,}\b/ misses both.
const LONG_NUMBER = /\b\d[\d_]{11,}n?\b/;

const isTestFile = (p: string): boolean =>
  /\.(spec|test)\.[tj]sx?$/.test(p) ||
  p.includes(`${path.sep}__tests__${path.sep}`) ||
  p.includes(`${path.sep}testing${path.sep}`);

/**
 * Remove block comments, JSX comments and line comments from source text.
 *
 * `//` is only treated as a comment when NOT preceded by `:`, so a URL such as
 * `https://discord.com/...?permissions=<n>` keeps its query string and stays
 * scannable — stripping it would let the exact literal this guard exists to
 * catch hide inside a hardcoded invite link.
 *
 * @param source - Raw file contents.
 * @returns The contents with comment text blanked out, line count preserved.
 */
export function stripComments(source: string): string {
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, (m) =>
    m.replace(/[^\n]/g, ' '),
  );
  return withoutBlocks
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

/** Recursively collect scannable, non-test files under a directory. */
function collectFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' || entry.name === 'dist'
        ? []
        : collectFiles(full);
    }
    if (!SCANNED_EXTENSIONS.includes(path.extname(entry.name))) return [];
    return isTestFile(full) ? [] : [full];
  });
}

/** Every `file:line` in the scanned scope holding a long numeric literal. */
function findLongNumberLiterals(): string[] {
  const files = [
    ...SCANNED_DIRS.flatMap((d) => collectFiles(path.join(REPO_ROOT, d))),
    ...SCANNED_FILES.map((f) => path.join(REPO_ROOT, f)).filter((f) =>
      fs.existsSync(f),
    ),
  ];
  return files.flatMap((file) => {
    const rel = path.relative(REPO_ROOT, file);
    if (ALLOWLIST.some((a) => a.file === rel)) return [];
    return stripComments(fs.readFileSync(file, 'utf8'))
      .split('\n')
      .flatMap((line, i) => {
        const hit = LONG_NUMBER.exec(line);
        return hit ? [`${rel}:${i + 1} -> ${hit[0]}`] : [];
      });
  });
}

describe('no hardcoded Discord permission integer (ROK-1471 AC15)', () => {
  it('finds no 12+ digit literal in bot, admin-UI, contract or README source', () => {
    expect(findLongNumberLiterals()).toEqual([]);
  });

  it('actually scans a non-trivial number of files', () => {
    const count = SCANNED_DIRS.flatMap((d) =>
      collectFiles(path.join(REPO_ROOT, d)),
    ).length;
    expect(count).toBeGreaterThan(50);
  });
});

describe('stripComments (ROK-1314: strip before matching)', () => {
  it('blanks block, JSX and line comments', () => {
    expect(stripComments('/* 589674583247891 */ const a = 1;')).not.toMatch(
      LONG_NUMBER,
    );
    expect(
      stripComments('{/* 589674583247891 */}\n<div />'),
    ).not.toMatch(LONG_NUMBER);
    expect(stripComments('const a = 1; // 589674583247891')).not.toMatch(
      LONG_NUMBER,
    );
  });

  it('keeps real code, including inside a URL with a protocol slash-slash', () => {
    expect(stripComments("const bits = 589674583247891n;")).toMatch(LONG_NUMBER);
    expect(
      stripComments(
        "const u = 'https://discord.com/oauth2/authorize?permissions=589674583247891';",
      ),
    ).toMatch(LONG_NUMBER);
  });

  it('preserves line numbers so the failure names the right line', () => {
    const src = 'a\n/* multi\nline */\nb';
    expect(stripComments(src).split('\n')).toHaveLength(4);
  });
});
