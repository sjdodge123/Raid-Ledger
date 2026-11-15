/**
 * ROK-2210 guard: every WoW Classic/Forever instance id→name, name→level and
 * zone→id table lives in `instance-catalogue/`. A source scan (comments
 * stripped) of api/src, api/scripts and web/src fails on a new hand-rolled
 * table anywhere else. Lanes 1b–1d migrated every pending file; the list is
 * now empty and must stay so. A fixture tree proves each detector still fires.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { stripComments } from '../../../common/testing/strip-comments';
import {
  buildNameKeyRe,
  scanCatalogueSource,
  type CatalogueScanHit,
  type CatalogueVocabulary,
} from '../../../common/testing/instance-catalogue-scan';
import { allCatalogueRows } from './instance-catalogue';

const REPO = path.resolve(__dirname, '../../../../..');
const MODULE_DIR = path.relative(REPO, __dirname);
const ROOTS = ['api/src', 'api/scripts', 'web/src'];
const SOURCE_RE = /\.(ts|tsx|mjs|js)$/;
const TEST_RE = /\.(spec|test)\.(ts|tsx|mjs|js)$|\.d\.ts$/;
/** Catalogue ids below 100 that are still scanned (63/64 dungeons, 76 ZG). */
const SMALL_IDS = new Set([63, 64, 76]);

/**
 * Files awaiting migration onto the catalogue. Lanes 1b–1d emptied it; a
 * test asserts it stays empty — a real exemption goes in ALLOWED with a reason.
 */
const PENDING_MIGRATION: readonly string[] = [];

/** Legitimate non-catalogue tables, each with its reason. */
const ALLOWED: Readonly<Record<string, string>> = {};

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === 'node_modules' ? [] : walk(full);
    return SOURCE_RE.test(d.name) && !TEST_RE.test(d.name) ? [full] : [];
  });
}

function vocabulary(): CatalogueVocabulary {
  const rows = allCatalogueRows();
  const ids = rows
    .map((r) => r.id)
    .filter((id) => id >= 100 || SMALL_IDS.has(id));
  const names = rows.flatMap((r) =>
    r.questName ? [r.name, r.questName] : [r.name],
  );
  return { ids: new Set(ids), names: [...new Set(names)] };
}

const VOCAB = vocabulary();
const NAME_RE = buildNameKeyRe(VOCAB.names);

function scanText(text: string): CatalogueScanHit[] {
  return scanCatalogueSource(stripComments(text), VOCAB, NAME_RE);
}

/** Test mocks and DEMO_MODE wireframes may spell a level; tables still count. */
const LEVEL_EXEMPT_DIRS = [
  path.join('web', 'src', 'test'),
  path.join('web', 'src', 'dev'),
];

function exemptLevels(
  rel: string,
  hits: CatalogueScanHit[],
): CatalogueScanHit[] {
  const exempt = LEVEL_EXEMPT_DIRS.some((d) =>
    rel.startsWith(`${d}${path.sep}`),
  );
  return exempt ? hits.filter((h) => h.detector !== 'level-literal') : hits;
}

function scanTree(
  base: string,
  roots: readonly string[],
  skipDir: string | null,
): Map<string, CatalogueScanHit[]> {
  return new Map(
    roots
      .flatMap((root) => walk(path.join(base, root)))
      .map((file) => path.relative(base, file))
      .filter((rel) => !skipDir || !rel.startsWith(`${skipDir}${path.sep}`))
      .map((rel): [string, CatalogueScanHit[]] => [
        rel,
        exemptLevels(
          rel,
          scanText(fs.readFileSync(path.join(base, rel), 'utf8')),
        ),
      ])
      .filter(([, hits]) => hits.length > 0),
  );
}

const OFFENDERS: ReadonlyMap<string, CatalogueScanHit[]> = scanTree(
  REPO,
  ROOTS,
  MODULE_DIR,
);

function describeHits(file: string, hits: CatalogueScanHit[]): string {
  const first = hits
    .slice(0, 3)
    .map((h) => `${h.detector}@${h.line}(${h.token})`);
  return `${file}: ${first.join(', ')}`;
}

describe('instance-catalogue guard — scan', () => {
  it('finds no hand-rolled instance table outside the catalogue module', () => {
    const exempt = new Set(Object.keys(ALLOWED));
    const fresh = [...OFFENDERS]
      .filter(([file]) => !exempt.has(file))
      .map(([file, hits]) => describeHits(file, hits));
    expect(fresh).toEqual([]);
  });

  it('has no pending migrations left (never re-add an exemption here)', () => {
    expect(PENDING_MIGRATION).toEqual([]);
  });

  it('keeps every ALLOWED exemption live (a cleaned file must leave it)', () => {
    const stale = Object.keys(ALLOWED).filter((file) => !OFFENDERS.has(file));
    expect(stale).toEqual([]);
  });

  it('scans the real tree with the real catalogue vocabulary', () => {
    expect(
      ROOTS.flatMap((r) => walk(path.join(REPO, r))).length,
    ).toBeGreaterThan(100);
    expect(VOCAB.ids.has(22901)).toBe(true);
    expect(VOCAB.names).toContain('Blackrock Spire');
  });
});

describe('instance-catalogue guard — fixture tree (positive case)', () => {
  const FIXTURE = [
    '// a hand-rolled table the guard must catch',
    'export const NAMES = {',
    "  226: 'Ragefire Chasm',",
    "  240: 'Wailing Caverns',",
    "  63: 'Deadmines',",
    '};',
    'export const LEVELS = {',
    '  "Ragefire Chasm": 13,',
    '  "Wailing Caverns": 17,',
    "  'Blackrock Spire': 55,",
    '};',
    'export const ROWS = [{ id: 226, minimumLevel: 13 }];',
    'export const ZONE_TO_INSTANCE = {',
    '  717: 238,',
    '  1581: 63,',
    '  491: 234,',
    '};',
  ].join('\n');
  let dir = '';

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rok2210-guard-'));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'hand-rolled.ts'), FIXTURE);
    fs.writeFileSync(path.join(dir, 'src', 'clean.ts'), 'export const x = 1;');
  });

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('reports only the hand-rolled file, through every detector', () => {
    const found = scanTree(dir, ['src'], null);
    expect([...found.keys()]).toEqual([path.join('src', 'hand-rolled.ts')]);
    const detectors = new Set(
      (found.get(path.join('src', 'hand-rolled.ts')) ?? []).map(
        (h) => h.detector,
      ),
    );
    expect([...detectors].sort()).toEqual([
      'id-map',
      'level-literal',
      'name-map',
      'zone-map',
    ]);
  });
});

describe('instance-catalogue guard — detectors', () => {
  const idMap = 'const M = {\n  226: "a",\n  240: "b",\n  63: "c",\n};';
  const nameMap =
    "const N = {\n  'Ragefire Chasm': 1,\n  Deadmines: 2,\n  \"Zul'Farrak\": 3,\n};";
  const level = 'const row = { minimumLevel: 13 };';
  const zoneMap = 'const Z = {\n  717: 238,\n  1581: 63,\n  491: 234,\n};';

  it.each([
    ['id-map', idMap],
    ['name-map', nameMap],
    ['level-literal', level],
    ['zone-map', zoneMap],
  ])('flags a %s', (detector, source) => {
    expect(scanText(source).map((h) => h.detector)).toContain(detector);
  });

  it.each([idMap, nameMap, level, zoneMap])(
    'ignores the same table inside a comment',
    (source) => {
      expect(scanText(`/*\n${source}\n*/`)).toEqual([]);
    },
  );

  it('ignores two-key maps, wing names in strings and non-literal levels', () => {
    expect(scanText('const M = { 226: 1, 240: 2 };')).toEqual([]);
    expect(
      scanText(
        "const s = ['Maraudon: Purple', 'SM: Library', 'Dire Maul: x'];",
      ),
    ).toEqual([]);
    expect(
      scanText(
        'const r = { minimumLevel: x.minimumLevel, maximumLevel: null };',
      ),
    ).toEqual([]);
  });

  it('ignores switch cases and ternaries that mention catalogue ids', () => {
    const cases = 'switch (id) {\n  case 226:\n  case 240:\n  case 63:\n}';
    const ternary =
      'const a = x ? 226 : 240;\nconst b = y\n  ? 63\n  : 238;\nconst c = z ? 64 : 0;';
    expect(scanText(cases)).toEqual([]);
    expect(scanText(ternary)).toEqual([]);
  });
});

describe('instance-catalogue guard — level-literal exempt dirs', () => {
  const LEVEL = 'export const row = { minimumLevel: 13 };';
  const ID_MAP = 'export const M = {\n  226: "a",\n  240: "b",\n  63: "c",\n};';
  let dir = '';

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rok2210-exempt-'));
    const write = (rel: string, text: string): void => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), text);
    };
    write('web/src/test/mock-instances.ts', LEVEL);
    write('web/src/dev/wireframe.tsx', LEVEL);
    write('web/src/test/id-map.ts', ID_MAP);
    write('web/src/pages/level.tsx', LEVEL);
  });

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('skips level literals in test mocks and dev wireframes only', () => {
    const found = scanTree(dir, ['web/src'], null);
    expect([...found.keys()].sort()).toEqual([
      path.join('web', 'src', 'pages', 'level.tsx'),
      path.join('web', 'src', 'test', 'id-map.ts'),
    ]);
  });
});
