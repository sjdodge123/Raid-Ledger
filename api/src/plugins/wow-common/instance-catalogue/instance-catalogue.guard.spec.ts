/**
 * ROK-2210 guard: every WoW Classic/Forever instance id→name, name→level and
 * zone→id table lives in `instance-catalogue/`. A source scan (comments
 * stripped) of api/src, api/scripts and web/src fails on a new hand-rolled
 * table anywhere else. Lanes 1b–1d shrink PENDING_MIGRATION; 1d ends it empty.
 */
import * as fs from 'fs';
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
 * Files lanes 1b–1d migrate onto the catalogue. Never add to this list;
 * each lane deletes the entries it converts (one per line — R8).
 */
const PENDING_MIGRATION: readonly string[] = [
  // lane 1b — §f 15 (old name-keyed level/short-name tables)
  'api/src/plugins/wow-common/blizzard-instance-data.ts',
  // lane 1c — §f 6 (JOURNAL_NAMES id→name map)
  'api/src/plugins/wow-common/dungeon-instance-names.ts',
  // lane 1c — §f 6 (CLASSIC_WING_PARENT_IDS)
  'api/src/plugins/wow-common/forever-instance-aliases.ts',
  // lane 1d — §f 9 (CLASSIC_QUEST_AREAS keyed by instance id)
  'api/src/plugins/wow-common/forever-quest-import/classic-quest-areas.ts',
  // lane 1d — §f 12 (ZONE_TO_INSTANCE zone→id map)
  'api/scripts/import-forever-boss-loot.mjs',
  // lane 1d — NOT in the spec §f list: SUB_INSTANCE_PARENTS wing map (found by 1a)
  'api/scripts/fetch-boss-data.mjs',
  // lane 1d — §f 17 (demo raid fixture: 90_000_001 "Molten Core" literal)
  'api/src/admin/demo-test-guild-raids.helpers.ts',
];

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

const OFFENDERS: ReadonlyMap<string, CatalogueScanHit[]> = new Map(
  ROOTS.flatMap((root) => walk(path.join(REPO, root)))
    .map((file) => path.relative(REPO, file))
    .filter((rel) => !rel.startsWith(`${MODULE_DIR}${path.sep}`))
    .map((rel): [string, CatalogueScanHit[]] => [
      rel,
      scanText(fs.readFileSync(path.join(REPO, rel), 'utf8')),
    ])
    .filter(([, hits]) => hits.length > 0),
);

function describeHits(file: string, hits: CatalogueScanHit[]): string {
  const first = hits
    .slice(0, 3)
    .map((h) => `${h.detector}@${h.line}(${h.token})`);
  return `${file}: ${first.join(', ')}`;
}

describe('instance-catalogue guard — scan', () => {
  it('finds no hand-rolled instance table outside the catalogue module', () => {
    const exempt = new Set([...PENDING_MIGRATION, ...Object.keys(ALLOWED)]);
    const fresh = [...OFFENDERS]
      .filter(([file]) => !exempt.has(file))
      .map(([file, hits]) => describeHits(file, hits));
    expect(fresh).toEqual([]);
  });

  it('keeps every exemption live (a migrated file must leave the list)', () => {
    const stale = [...PENDING_MIGRATION, ...Object.keys(ALLOWED)].filter(
      (file) => !OFFENDERS.has(file),
    );
    expect(stale).toEqual([]);
  });

  it('scans a real tree (sanity)', () => {
    expect(OFFENDERS.size).toBeGreaterThan(0);
    expect(VOCAB.ids.has(22901)).toBe(true);
    expect(VOCAB.names).toContain('Blackrock Spire');
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
});
