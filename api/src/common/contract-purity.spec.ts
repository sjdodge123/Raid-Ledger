/**
 * ROK-1668 AC3 — source-scanning guard: `@raid-ledger/contract` stays pure.
 *
 * The contract package is shared by the api, the web bundle and (soon) the
 * relay hub. It must never pull in the api's server stack: a `drizzle-orm`,
 * `postgres` or `@nestjs/*` import there would drag a DB driver into the
 * browser bundle and couple every consumer to the api's runtime. The
 * game-identity helpers (moved out of the api in ROK-1668) are held to a
 * stricter rule still: they import nothing but their own './' siblings, so
 * any service can adopt them without adopting a dependency.
 *
 * The scan reads `packages/contract/src` (the source, never `dist`) so it
 * runs without a contract build.
 *
 * Comments are stripped before scanning (ROK-1314): otherwise prose that
 * names a forbidden package — including this file's own — would trip it.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import * as path from 'path';

const CONTRACT_SRC = path.resolve(__dirname, '../../../packages/contract/src');
const CONTRACT_PACKAGE_JSON = path.resolve(CONTRACT_SRC, '../package.json');
const GAME_IDENTITY_DIR = 'game-identity';

/** Server-stack packages the contract must never import or require. */
const FORBIDDEN_PACKAGES: ReadonlyArray<RegExp> = [
  /^drizzle-orm(\/|$)/,
  /^postgres(\/|$)/,
  /^@nestjs\//,
];

/** Every way a module specifier can appear in TypeScript source. */
const SPECIFIER_PATTERNS: ReadonlyArray<RegExp> = [
  /\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/** Strip block and line comments so prose cannot satisfy or trip the scan. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Module specifiers imported, re-exported or required by `source`. */
function extractSpecifiers(source: string): string[] {
  const code = stripComments(source);
  return SPECIFIER_PATTERNS.flatMap((pattern) =>
    [...code.matchAll(pattern)].map((match) => match[1]),
  );
}

/** Recursively collect `.ts` files under `dir`, as paths relative to it. */
function collectTsFiles(dir: string, rel = ''): string[] {
  return readdirSync(path.join(dir, rel)).flatMap((entry) => {
    const entryRel = path.posix.join(rel, entry);
    if (statSync(path.join(dir, entryRel)).isDirectory()) {
      return collectTsFiles(dir, entryRel);
    }
    return entry.endsWith('.ts') ? [entryRel] : [];
  });
}

function specifiersOf(relFile: string): string[] {
  return extractSpecifiers(readFileSync(path.join(CONTRACT_SRC, relFile), 'utf8'));
}

const contractFiles = collectTsFiles(CONTRACT_SRC);
const gameIdentityFiles = contractFiles.filter((f) =>
  f.startsWith(`${GAME_IDENTITY_DIR}/`),
);

describe('extractSpecifiers (guard self-check)', () => {
  it('finds import, re-export, side-effect, require and dynamic forms', () => {
    const source = [
      "import { a } from 'pkg-a';",
      "export * from './b.js';",
      "import 'pkg-c';",
      "const d = require('pkg-d');",
      "void import('pkg-e');",
    ].join('\n');
    expect(extractSpecifiers(source)).toEqual(
      expect.arrayContaining(['pkg-a', './b.js', 'pkg-c', 'pkg-d', 'pkg-e']),
    );
  });

  it('ignores specifiers that only appear in comments', () => {
    const source = "// import 'drizzle-orm';\n/* from 'postgres' */\nconst x = 1;";
    expect(extractSpecifiers(source)).toEqual([]);
  });
});

describe('@raid-ledger/contract purity (ROK-1668 AC3)', () => {
  it('scans real source files, including the game-identity folder', () => {
    expect(contractFiles.length).toBeGreaterThan(10);
    expect(gameIdentityFiles).toEqual(
      expect.arrayContaining(['game-identity/normalize-name.ts']),
    );
  });

  it('no contract source file imports drizzle-orm, postgres or @nestjs/*', () => {
    const offenders = contractFiles.flatMap((file) =>
      specifiersOf(file)
        .filter((spec) => FORBIDDEN_PACKAGES.some((re) => re.test(spec)))
        .map((spec) => `${file} imports '${spec}'`),
    );
    expect(offenders).toEqual([]);
  });

  it("game-identity files import only './' siblings", () => {
    const offenders = gameIdentityFiles.flatMap((file) =>
      specifiersOf(file)
        .filter((spec) => !spec.startsWith('./'))
        .map((spec) => `${file} imports '${spec}'`),
    );
    expect(offenders).toEqual([]);
  });

  it('packages/contract/package.json does not depend on drizzle-orm', () => {
    const pkg = JSON.parse(readFileSync(CONTRACT_PACKAGE_JSON, 'utf8')) as Record<
      string,
      Record<string, string> | undefined
    >;
    const sections = [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ];
    const offenders = sections.filter((s) => pkg[s]?.['drizzle-orm']);
    expect(offenders).toEqual([]);
  });
});
