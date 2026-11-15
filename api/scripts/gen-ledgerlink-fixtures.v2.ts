/**
 * The v2 half of `gen-ledgerlink-fixtures.ts` (ROK-2184) — the ONE source of
 * the `packages/contract/ledgerlink/v2/fixtures/` folder (it replaced L1's
 * string-only `gen-ledgerlink-v2-fixtures.mjs`, which could not run the
 * decoder). Everything is checked against the REAL decoder before a byte is
 * written:
 * 1. a v2 twin of every valid v1 fixture ON DISK (hand-made ones such as
 *    `guild-ingame-text` included): each `!RL1!` token re-encoded `!RL2!`
 *    with payload `schema: 2`; its decoded view must equal the v1 view with
 *    `schema: 2` (AC 2);
 * 2. synthetic `loot` cases (`testing/addon-fixture.loot.ts`);
 * 3. invalid v2 cases, each failing with its stated code.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { deflateSync, inflateSync } from 'node:zlib';
import {
  COMPANION_WOW_LEDGERLINK_EXPORT_MAX,
  type AddonImportErrorCode,
} from '@raid-ledger/contract';
import { decodeImportPaste } from '../src/plugins/wow-common/addon-import/addon-import.decoder';
import { buildImportString } from '../src/plugins/wow-common/addon-import/testing/addon-fixture.builder';
import {
  buildLootDrop,
  buildLootFixturePayload,
  buildLootPayload,
} from '../src/plugins/wow-common/addon-import/testing/addon-fixture.loot';
import {
  fixtureViewWithSchema,
  ledgerLinkFixtureView,
} from '../src/plugins/wow-common/addon-import/testing/ledgerlink-fixture-view';
import {
  FIXTURE_NOW_MS,
  codeOf,
  fmt,
  type FixtureFile,
} from './ledgerlink-fixtures.io';

const TOKEN_RE = /!RL1!([a-z]+(?:-\d+of\d+)?)!([A-Za-z0-9+/]+={0,2})/g;

const zip = (payload: unknown): string =>
  deflateSync(Buffer.from(JSON.stringify(payload), 'utf8')).toString('base64');

/** Re-encode every `!RL1!` token of a paste as `!RL2!` + `schema: 2`. */
export function toV2Paste(v1Paste: string): string {
  return v1Paste.replace(TOKEN_RE, (_m, head: string, body: string) => {
    const json = inflateSync(Buffer.from(body, 'base64')).toString('utf8');
    const payload = JSON.parse(json) as Record<string, unknown>;
    payload.schema = 2;
    return `!RL2!${head}!${zip(payload)}`;
  });
}

const lootToken = (payload: unknown, page?: { n: number; of: number }) =>
  buildImportString(payload, {
    version: 2,
    section: 'loot',
    ...(page ? { page } : {}),
  });

function validLootCases(v2Shuffled: string): Record<string, string> {
  const loot = lootToken(buildLootFixturePayload());
  return {
    loot,
    'loot-empty-window': lootToken(buildLootPayload([])),
    'mixed-char-guild3-raid-loot': `${loot}\n${v2Shuffled}`,
  };
}

function invalidCases(
  v1Dir: string,
): Record<string, [AddonImportErrorCode, string]> {
  const loot = lootToken(buildLootFixturePayload());
  const noEncounterId = buildLootDrop(0);
  delete noEncounterId.encounterId;
  const v1Raid = readFileSync(join(v1Dir, 'raid.txt'), 'utf8').trim();
  const raid = JSON.parse(
    inflateSync(Buffer.from(v1Raid.split('!')[3] ?? '', 'base64')).toString(
      'utf8',
    ),
  ) as object;
  const base = buildLootPayload([]);
  const unknownKey = {
    ...base,
    data: { ...base.data, drops: [{ ...buildLootDrop(0), roll: 87 }] },
  };
  const tooMany = Array.from({ length: 501 }, (_, i) => buildLootDrop(i % 400));
  return {
    'loot-too-many-drops': [
      'INVALID_PAYLOAD',
      lootToken(buildLootPayload(tooMany)),
    ],
    'loot-unknown-key': ['INVALID_PAYLOAD', lootToken(unknownKey)],
    'loot-drop-outside-window': [
      'INVALID_PAYLOAD',
      lootToken(buildLootPayload([buildLootDrop(0, { at: 1_790_000_060 })])),
    ],
    'loot-encounter-name-without-id': [
      'INVALID_PAYLOAD',
      lootToken(buildLootPayload([noEncounterId])),
    ],
    'loot-paged': [
      'BAD_HEADER',
      [1, 2]
        .map((n) =>
          lootToken(buildLootPayload([buildLootDrop(n)]), { n, of: 2 }),
        )
        .join('\n'),
    ],
    'loot-two-tokens': [
      'PAGES_INCOMPLETE',
      `${loot}\n${lootToken(buildLootPayload([buildLootDrop(1)]))}`,
    ],
    'v1-loot-section': [
      'BAD_HEADER',
      buildImportString(
        { ...buildLootFixturePayload(), schema: 1 },
        { version: 1, section: 'loot' },
      ),
    ],
    'mixed-v1-v2': ['UNSUPPORTED_VERSION', `${v1Raid}\n${loot}`],
    // Header v2, body schema 1 — the same string as v1 invalid/unsupported-version.
    'v2-header-schema-1': [
      'UNSUPPORTED_VERSION',
      readFileSync(join(v1Dir, 'invalid', 'unsupported-version.txt'), 'utf8'),
    ],
    'unsupported-version': [
      'UNSUPPORTED_VERSION',
      buildImportString(
        { ...raid, schema: 3 },
        { version: 3, section: 'raid' },
      ),
    ],
  };
}

/** 500 realistic drops (no links) must fit what the companion uploads. */
function assertRealisticLootTokenFits(): void {
  const drops = Array.from({ length: 500 }, (_, i) => buildLootDrop(i % 400));
  const bytes = Buffer.byteLength(lootToken(buildLootPayload(drops)), 'utf8');
  if (bytes > COMPANION_WOW_LEDGERLINK_EXPORT_MAX)
    throw new Error(
      `500-drop loot token is ${bytes} B > ${COMPANION_WOW_LEDGERLINK_EXPORT_MAX}`,
    );
  console.log(`realistic 500-drop loot token: ${bytes} B`);
}

/**
 * Every v2 fixture file, validated; throws (writing nothing) listing every
 * case the decoder disagrees with.
 */
export function buildV2Fixtures(v1Dir: string): FixtureFile[] {
  assertRealisticLootTokenFits();
  const files: FixtureFile[] = [];
  const problems: string[] = [];
  const decodeView = (name: string, paste: string): unknown => {
    try {
      return ledgerLinkFixtureView(decodeImportPaste(paste, FIXTURE_NOW_MS));
    } catch (err) {
      problems.push(`${name}: ${String(err)}`);
      return undefined;
    }
  };
  const emit = (name: string, paste: string, view: unknown) =>
    files.push(
      { path: `${name}.txt`, content: paste },
      { path: `${name}.json`, content: `${fmt(view)}\n` },
    );
  let shuffled = '';
  for (const f of readdirSync(v1Dir)
    .filter((x) => x.endsWith('.txt'))
    .sort()) {
    const name = f.slice(0, -'.txt'.length);
    const paste = toV2Paste(readFileSync(join(v1Dir, f), 'utf8'));
    const v1View: object = JSON.parse(
      readFileSync(join(v1Dir, `${name}.json`), 'utf8'),
    );
    const view = decodeView(name, paste);
    if (
      view !== undefined &&
      !isDeepStrictEqual(view, fixtureViewWithSchema(v1View, 2))
    )
      problems.push(`${name}: v2 view differs from the v1 view (AC 2)`);
    if (name === 'mixed-char-guild3-raid-shuffled') shuffled = paste;
    emit(name, paste, view);
  }
  for (const [name, paste] of Object.entries(validLootCases(shuffled)))
    emit(name, paste, decodeView(name, paste));
  for (const [name, [code, paste]] of Object.entries(invalidCases(v1Dir))) {
    const got = codeOf(paste, FIXTURE_NOW_MS);
    if (got !== code)
      problems.push(`invalid/${name}: expected ${code}, decoder gave ${got}`);
    files.push(
      { path: `invalid/${name}.txt`, content: paste },
      { path: `invalid/${name}.json`, content: `${fmt({ code })}\n` },
    );
  }
  if (problems.length)
    throw new Error(`v2 fixtures NOT written:\n  ${problems.join('\n  ')}`);
  return files;
}
