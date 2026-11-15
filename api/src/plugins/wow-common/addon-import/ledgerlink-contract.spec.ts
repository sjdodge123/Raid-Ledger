/**
 * LedgerLink v1 + v2 conformance + drift guard (ROK-1724, ROK-2184). Raid
 * Ledger owns the addon wire format (`packages/contract/ledgerlink/v{1,2}/
 * CONTRACT.md`); for EACH version folder:
 * - every golden `fixtures/*.txt` decodes, with the REAL decoder, to its
 *   `.json` (single-section `{ pages, payload }`, mixed `{ sections }`); every `fixtures/invalid/*.txt` fails with its `.json` code;
 * - the committed `schema.json` equals a fresh generation from the Zod
 *   source of truth. Fix drift with
 *   `npm run gen:ledgerlink-schema -w @raid-ledger/contract`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  AddonImportErrorCodeSchema,
  COMPANION_WOW_LEDGERLINK_EXPORT_MAX,
  serializeLedgerLinkJsonSchema,
  serializeLedgerLinkV2JsonSchema,
} from '@raid-ledger/contract';
import { decodeImportPaste } from './addon-import.decoder';
import { AddonImportError } from './addon-import.errors';
import { buildImportString } from './testing/addon-fixture.builder';
import { buildForeverQuestsPayload } from './testing/addon-fixture.forever';
import {
  buildMailworthyBlock,
  buildMailworthyWorstCaseBlock,
} from './testing/addon-fixture.mailworthy';
import {
  buildInstalledAddons,
  buildInstalledAddonsWorstCase,
} from './testing/addon-fixture.installed';
import {
  fixtureViewWithSchema,
  ledgerLinkFixtureView,
} from './testing/ledgerlink-fixture-view';
import {
  TALENT_COL_STEP,
  TALENT_ROW_ORIGIN,
  TALENT_ROW_STEP,
  clusterOrigins,
} from '../forever-talents.adapter';
import { buildLootFixturePayload } from './testing/addon-fixture.loot';
import { pinExportClock } from './testing/pin-export-clock';

pinExportClock();

const LEDGERLINK = join(
  __dirname,
  '../../../../../packages/contract/ledgerlink',
);
/** v1 is frozen (ROK-2184): its folder never follows the current version. */
const V1 = join(LEDGERLINK, 'v1');
const FIXTURES = join(V1, 'fixtures');
const INVALID = join(FIXTURES, 'invalid');
const V2 = join(LEDGERLINK, 'v2');
const V2_FIXTURES = join(V2, 'fixtures');
const V2_INVALID = join(V2_FIXTURES, 'invalid');

const namesIn = (dir: string): string[] =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.txt'))
    .map((f) => f.slice(0, -'.txt'.length))
    .sort();

const read = (dir: string, file: string): string =>
  readFileSync(join(dir, file), 'utf8');

function decodeErrorCode(paste: string): string {
  try {
    decodeImportPaste(paste);
  } catch (err) {
    if (err instanceof AddonImportError) return err.code;
    throw err;
  }
  return 'DECODED_WITHOUT_ERROR';
}

const V1_VALID = [
  'char-forever-quests',
  'char-forever-quests-log-only',
  'char-forever-quests-truncated',
  'char-forever-talents-named',
  'char-installed-addons',
  'char-mailworthy',
  'char-mailworthy-template-only',
  'char-normal',
  'char-null-ruleset-no-guild',
  'char-roleplaying',
  'char-rppvp',
  'guild-1-page',
  'guild-3-pages',
  'guild-8-pages-2000-members',
  'guild-ingame-text',
  'mixed-char-guild3-raid-shuffled',
  'mixed-char-raid',
  'raid',
];

describe('LedgerLink v1 golden fixtures — valid', () => {
  const names = namesIn(FIXTURES);

  it('ships the agreed valid cases', () => {
    expect(names).toEqual(V1_VALID);
  });

  it.each(names)('%s.txt decodes to %s.json', (name) => {
    const expected: unknown = JSON.parse(read(FIXTURES, `${name}.json`));
    const decoded = decodeImportPaste(read(FIXTURES, `${name}.txt`));
    expect(ledgerLinkFixtureView(decoded)).toEqual(expected);
  });
});

describe('LedgerLink v1 golden fixtures — invalid', () => {
  const names = namesIn(INVALID);

  it('ships at least the unknown-key, oversized and page-set cases', () => {
    expect(names).toEqual(
      expect.arrayContaining([
        'unknown-key-officer-note',
        'decoded-too-large',
        'pages-missing-middle',
        'mixed-two-char',
        'mixed-guild-incomplete',
        'mixed-different-exporters',
        'mixed-11-tokens',
        'gender-unknown-value',
        'quests-completed-over-cap',
        'char-mailworthy-rule-cap',
        'char-mailworthy-too-many-rules',
        'char-addons-too-many',
        'char-addons-name-too-long',
      ]),
    );
  });

  it.each(names)('invalid/%s.txt is rejected with its code', (name) => {
    const { code } = JSON.parse(read(INVALID, `${name}.json`)) as {
      code: string;
    };
    expect(AddonImportErrorCodeSchema.options).toContain(code);
    expect(decodeErrorCode(read(INVALID, `${name}.txt`))).toBe(code);
  });
});

interface PositionedNode {
  name: string;
  tree: number;
  row: number;
  col: number;
  posX: number;
  posY: number;
}

/** CONTRACT.md §3: tree = posX cluster, col/row = rounded 600-unit steps. */
function contractSlot(n: PositionedNode, origins: number[]) {
  const tree = origins.filter((o) => o <= n.posX).length - 1;
  const origin = origins[tree] ?? Number.NaN;
  return {
    name: n.name,
    tree,
    row: Math.round((n.posY - TALENT_ROW_ORIGIN) / TALENT_ROW_STEP),
    col: Math.round((n.posX - origin) / TALENT_COL_STEP),
  };
}

describe('char-mailworthy — the block survives decode (ROK-2148)', () => {
  it('carries the Mailworthy block beside the frozen snapshot data', () => {
    const decoded = decodeImportPaste(read(FIXTURES, 'char-mailworthy.txt'));
    const payload = decoded.sections.char?.payload;
    expect(payload?.mailworthy).toEqual(buildMailworthyBlock());
    expect(payload?.data).not.toHaveProperty('mailworthy');
  });

  it('a char export without the block decodes without the key', () => {
    const decoded = decodeImportPaste(read(FIXTURES, 'char-normal.txt'));
    expect(decoded.sections.char?.payload).not.toHaveProperty('mailworthy');
  });
});

describe('worst-case Mailworthy char string (ROK-2148 §A.4, delta 2026-11-08)', () => {
  it('max quests + 1000 peers + 200 givers × 35 days fits the Companion cap', () => {
    const char = buildForeverQuestsPayload();
    const mailworthy = buildMailworthyWorstCaseBlock();
    const paste = buildImportString({
      ...char,
      data: { ...char.data, mailworthy },
    });
    const bytes = Buffer.byteLength(paste, 'utf8');
    expect(bytes).toBe(45_926);
    expect(bytes).toBeLessThanOrEqual(COMPANION_WOW_LEDGERLINK_EXPORT_MAX);
    const decoded = decodeImportPaste(paste);
    expect(decoded.sections.char?.payload.mailworthy?.givers).toHaveLength(200);
  });
});

describe('char-installed-addons — the list survives decode (ROK-2147)', () => {
  it('carries the list beside the frozen snapshot data, escapes stripped', () => {
    const decoded = decodeImportPaste(
      read(FIXTURES, 'char-installed-addons.txt'),
    );
    const payload = decoded.sections.char?.payload;
    const [first, ...rest] = buildInstalledAddons();
    expect(payload?.addons).toEqual([
      { ...first, title: 'LedgerLink' },
      ...rest,
    ]);
    expect(payload?.addons?.map((a) => a.loaded)).toContain(false);
    expect(payload?.data).not.toHaveProperty('addons');
  });

  it('a char export without the list decodes without the key', () => {
    const decoded = decodeImportPaste(read(FIXTURES, 'char-normal.txt'));
    expect(decoded.sections.char?.payload).not.toHaveProperty('addons');
  });
});

describe('worst-case char string with installed addons (ROK-2147 §2 D8)', () => {
  it('max quests + max Mailworthy + 500 max-length addons fits the Companion cap', () => {
    const char = buildForeverQuestsPayload();
    const paste = buildImportString({
      ...char,
      data: {
        ...char.data,
        mailworthy: buildMailworthyWorstCaseBlock(),
        addons: buildInstalledAddonsWorstCase(),
      },
    });
    const bytes = Buffer.byteLength(paste, 'utf8');
    expect(bytes).toBe(133_134);
    expect(bytes).toBeLessThanOrEqual(COMPANION_WOW_LEDGERLINK_EXPORT_MAX);
    const decoded = decodeImportPaste(paste);
    expect(decoded.sections.char?.payload.addons).toHaveLength(500);
  });
});

describe('char-forever-talents-named — hints follow CONTRACT §3 (ROK-1758)', () => {
  it('every tree/row/col hint equals the rule applied to its own posX/posY', () => {
    const fixture = JSON.parse(
      read(FIXTURES, 'char-forever-talents-named.json'),
    ) as { payload: { data: { talents: { nodes: PositionedNode[] } } } };
    const nodes = fixture.payload.data.talents.nodes;
    const origins = clusterOrigins(nodes.map((n) => n.posX));
    expect(origins).toHaveLength(3);
    const hints = nodes.map(({ name, tree, row, col }) => ({
      name,
      tree,
      row,
      col,
    }));
    expect(hints).toEqual(nodes.map((n) => contractSlot(n, origins)));
  });
});

describe('LedgerLink schema.json drift guard', () => {
  it('v1 (frozen) matches a fresh generation from AddonExportSchema', () => {
    expect(read(V1, 'schema.json')).toBe(serializeLedgerLinkJsonSchema());
  });

  it('v2 matches a fresh generation from AddonExportV2Schema (AC 5)', () => {
    expect(read(V2, 'schema.json')).toBe(serializeLedgerLinkV2JsonSchema());
  });
});

const LOOT_VALID = ['loot', 'loot-empty-window', 'mixed-char-guild3-raid-loot'];

const decodeView = (dir: string, name: string): object =>
  ledgerLinkFixtureView(decodeImportPaste(read(dir, `${name}.txt`)));

describe('LedgerLink v2 golden fixtures — valid (ROK-2184)', () => {
  const names = namesIn(V2_FIXTURES);

  it('ships a v2 twin of every v1 case plus the loot cases', () => {
    expect(names).toEqual([...V1_VALID, ...LOOT_VALID].sort());
  });

  it.each(names)('%s.txt decodes to %s.json', (name) => {
    const expected: unknown = JSON.parse(read(V2_FIXTURES, `${name}.json`));
    expect(decodeView(V2_FIXTURES, name)).toEqual(expected);
  });

  it.each(V1_VALID)(
    '%s: the !RL2! twin decodes to the v1 view, schema 2 (AC 2)',
    (name) => {
      expect(decodeView(V2_FIXTURES, name)).toEqual(
        fixtureViewWithSchema(decodeView(FIXTURES, name), 2),
      );
    },
  );
});

describe('LedgerLink v2 loot section decodes (ROK-2184)', () => {
  const golden = buildLootFixturePayload();
  const dropKeys = golden.data.drops.map(({ at, itemId, looterName }) => ({
    at,
    itemId,
    looterName,
  }));

  it('loot.txt is the builder payload: window, quality floor, every drop', () => {
    expect(decodeView(V2_FIXTURES, 'loot')).toMatchObject({
      pages: 1,
      payload: {
        schema: 2,
        section: 'loot',
        who: golden.who,
        data: {
          windowStart: golden.data.windowStart,
          windowEnd: golden.data.windowEnd,
          minQuality: 2,
          drops: dropKeys,
        },
      },
    });
  });

  it('an empty window decodes with no drops', () => {
    expect(decodeView(V2_FIXTURES, 'loot-empty-window')).toMatchObject({
      pages: 1,
      payload: { section: 'loot', data: { drops: [] } },
    });
  });

  it('"Export all" + loot (loot token first) orders char → guild → raid → loot', () => {
    const decoded = decodeImportPaste(
      read(V2_FIXTURES, 'mixed-char-guild3-raid-loot.txt'),
    );
    expect(decoded.order).toEqual(['char', 'guild', 'raid', 'loot']);
    expect(decoded.tokens).toBe(6);
  });
});

describe('LedgerLink v2 golden fixtures — invalid (ROK-2184)', () => {
  const names = namesIn(V2_INVALID);

  it('ships the agreed loot, paging and version cases (AC 4)', () => {
    expect(names).toEqual([
      'loot-drop-outside-window',
      'loot-encounter-name-without-id',
      'loot-paged',
      'loot-too-many-drops',
      'loot-two-tokens',
      'loot-unknown-key',
      'mixed-v1-v2',
      'unsupported-version',
      'v1-loot-section',
      'v2-header-schema-1',
    ]);
  });

  it.each(names)('invalid/%s.txt is rejected with its code', (name) => {
    const { code } = JSON.parse(read(V2_INVALID, `${name}.json`)) as {
      code: string;
    };
    expect(AddonImportErrorCodeSchema.options).toContain(code);
    expect(decodeErrorCode(read(V2_INVALID, `${name}.txt`))).toBe(code);
  });
});
