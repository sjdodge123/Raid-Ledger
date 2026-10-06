/**
 * Regenerates the LedgerLink v1 golden fixtures in
 * `packages/contract/ledgerlink/v1/fixtures/` from the synthetic fixture
 * builder (no real player data) and the REAL decoder (ROK-1724).
 *
 *   cd api && npx ts-node scripts/gen-ledgerlink-fixtures.ts
 *
 * Valid case: `<name>.txt` (the paste) + `<name>.json` (the decoder's output:
 * `{ pages, payload }`, or `{ sections: [...] }` for a mixed paste — see
 * `ledgerLinkFixtureView`). Invalid case: `invalid/<name>.txt` +
 * `invalid/<name>.json` ({ code }). Conformance spec:
 * `src/plugins/wow-common/addon-import/ledgerlink-contract.spec.ts`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import type { AddonImportErrorCode } from '@raid-ledger/contract';
import { decodeImportPaste } from '../src/plugins/wow-common/addon-import/addon-import.decoder';
import { AddonImportError } from '../src/plugins/wow-common/addon-import/addon-import.errors';
import {
  FIXTURE_GUID,
  buildCharPayload,
  buildGuildPages,
  buildGuildPayload,
  buildImportString,
  buildMember,
  buildRaidPayload,
  buildWho,
  wrapImportBytes,
} from '../src/plugins/wow-common/addon-import/testing/addon-fixture.builder';
import { ledgerLinkFixtureView } from '../src/plugins/wow-common/addon-import/testing/ledgerlink-fixture-view';

const OUT = join(__dirname, '../../packages/contract/ledgerlink/v1/fixtures');
/** Members per page the addon emits (LedgerLink `Guild.MEMBERS_PER_PAGE`). */
const PER_PAGE = 250;

const members = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    buildMember(i + 1, i % 7 === 0 ? { note: 'Main tank' } : {}),
  );

/**
 * A roster of exactly `n` that INCLUDES the exporter (`FIXTURE_GUID`) as
 * its first member — apply rejects a roster without the exporter with
 * `NOT_IN_GUILD`, so a golden guild fixture must carry them.
 */
function roster(n: number) {
  const exporter = buildMember(0xabcdef0, {
    name: 'Ana Forever',
    class: 'PALADIN',
  });
  if (exporter.guid !== FIXTURE_GUID) throw new Error('exporter GUID drift');
  return [exporter, ...members(n - 1)];
}

function guildPaste(count: number): string {
  const payload = buildGuildPayload(roster(count));
  const of = Math.ceil(count / PER_PAGE);
  if (of === 1) return buildImportString(payload);
  return buildGuildPages(payload, of).join('\n');
}

function charNoGuild(): string {
  const who = buildWho({ ruleset: null });
  delete who.guildName;
  return buildImportString(buildCharPayload({ who }));
}

/** ROK-1737 "Export all": char + every guild page + raid, shuffled. */
function mixedAll(): string {
  const pages = buildGuildPages(buildGuildPayload(roster(600)), 3);
  const char = buildImportString(buildCharPayload());
  const raid = buildImportString(buildRaidPayload());
  return [pages[2], raid, pages[0], char, pages[1]].join('\n');
}

const mixedCharRaid = () =>
  [buildCharPayload(), buildRaidPayload()].map((p) => buildImportString(p));

const VALID: Record<string, () => string> = {
  'char-normal': () => buildImportString(buildCharPayload()),
  'char-roleplaying': () =>
    buildImportString(
      buildCharPayload({ who: buildWho({ ruleset: 'roleplaying' }) }),
    ),
  'char-null-ruleset-no-guild': charNoGuild,
  'guild-1-page': () => guildPaste(40),
  'guild-3-pages': () => guildPaste(600),
  'guild-8-pages-2000-members': () => guildPaste(2000),
  raid: () => buildImportString(buildRaidPayload()),
  'mixed-char-raid': () => mixedCharRaid().join('\n'),
  'mixed-char-guild3-raid-shuffled': mixedAll,
};

/** Body of a single-page string, asserting a property the case relies on. */
function bodyWhere(paste: string, ok: (b: string) => boolean): string {
  const body = paste.split('!').pop() ?? '';
  if (!ok(body)) throw new Error('fixture precondition failed — tweak it');
  return body;
}

function officerNote(): string {
  const payload = buildGuildPayload([buildMember(1)]);
  const member = { ...buildMember(1), officerNote: 'loot council: no' };
  return buildImportString({
    ...payload,
    data: { ...payload.data, members: [member] },
  });
}

function urlSafe(): string {
  const body = bodyWhere(buildImportString(buildRaidPayload()), (b) =>
    /[+/]/.test(b),
  );
  return `!RL1!raid!${body.replace(/\+/g, '-').replace(/\//g, '_')}`;
}

function unpadded(): string {
  const body = bodyWhere(buildImportString(buildRaidPayload()), (b) =>
    b.endsWith('='),
  );
  return `!RL1!raid!${body.replace(/=+$/, '')}`;
}

function mixedGuildIncomplete(): string {
  const pages = buildGuildPages(buildGuildPayload(roster(600)), 3);
  return [...mixedCharRaid(), pages[0], pages[2]].join('\n');
}

function mixedDifferentExporters(): string {
  const raid = {
    ...buildRaidPayload(),
    who: buildWho({ guid: 'Player-4395-0BBBBBB0', fullName: 'Bea Forever' }),
  };
  return [buildCharPayload(), raid].map((p) => buildImportString(p)).join('\n');
}

/** Same GUID + name, but the raid section claims another client region. */
function mixedDifferentRegion(): string {
  const base = buildRaidPayload();
  const raid = { ...base, client: { ...base.client, region: 3 } };
  return [buildCharPayload(), raid].map((p) => buildImportString(p)).join('\n');
}

function mixed11Tokens(): string {
  const pages = buildGuildPages(buildGuildPayload(roster(2000)), 8);
  return [...pages, ...mixedCharRaid(), mixedCharRaid()[1]].join('\n');
}

const INVALID: Record<string, [AddonImportErrorCode, () => string]> = {
  'unknown-key-officer-note': ['INVALID_PAYLOAD', officerNote],
  'ruleset-misspelled': [
    'INVALID_PAYLOAD',
    () =>
      buildImportString({
        ...buildCharPayload(),
        who: { ...buildWho(), ruleset: 'rp' },
      }),
  ],
  'region-as-string': [
    'INVALID_PAYLOAD',
    () =>
      buildImportString({
        ...buildCharPayload(),
        client: {
          interface: 11507,
          build: '1.15.7',
          locale: 'enUS',
          region: 'us',
        },
      }),
  ],
  'decoded-too-large': [
    'DECODED_TOO_LARGE',
    () =>
      wrapImportBytes(deflateSync(Buffer.alloc(2 * 1_048_576, 0x20)), {
        section: 'char',
      }),
  ],
  'pages-missing-middle': [
    'PAGES_INCOMPLETE',
    () =>
      buildGuildPages(buildGuildPayload(members(30)), 3)
        .filter((_, i) => i !== 1)
        .join('\n'),
  ],
  'too-many-pages': [
    'PAGES_INCOMPLETE',
    () =>
      Array.from({ length: 9 }, () =>
        buildImportString(buildRaidPayload()),
      ).join('\n'),
  ],
  'unsupported-version': [
    'UNSUPPORTED_VERSION',
    () => buildImportString(buildRaidPayload(), { version: 2 }),
  ],
  'url-safe-base64': ['BAD_HEADER', urlSafe],
  'unpadded-base64': ['CUT_OFF', unpadded],
  'mixed-two-char': [
    'PAGES_INCOMPLETE',
    () => [mixedCharRaid()[0], ...mixedCharRaid()].join('\n'),
  ],
  'mixed-guild-incomplete': ['PAGES_INCOMPLETE', mixedGuildIncomplete],
  'mixed-different-exporters': ['INVALID_PAYLOAD', mixedDifferentExporters],
  'mixed-different-region': ['INVALID_PAYLOAD', mixedDifferentRegion],
  'mixed-11-tokens': ['PAGES_INCOMPLETE', mixed11Tokens],
};

/** Pretty JSON, but containers 4+ levels deep stay on one line. */
function fmt(value: unknown, depth = 0): string {
  if (value === null || typeof value !== 'object' || depth >= 4) {
    return JSON.stringify(value);
  }
  const pad = '  '.repeat(depth + 1);
  const end = '  '.repeat(depth);
  const parts = Array.isArray(value)
    ? value.map((v) => pad + fmt(v, depth + 1))
    : Object.entries(value).map(
        ([k, v]) => `${pad}${JSON.stringify(k)}: ${fmt(v, depth + 1)}`,
      );
  const [open, close] = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
  return parts.length
    ? `${open}\n${parts.join(',\n')}\n${end}${close}`
    : `${open}${close}`;
}

function codeOf(paste: string): AddonImportErrorCode | null {
  try {
    decodeImportPaste(paste);
    return null;
  } catch (err) {
    if (err instanceof AddonImportError) return err.code;
    throw err;
  }
}

function main(): void {
  mkdirSync(join(OUT, 'invalid'), { recursive: true });
  for (const [name, build] of Object.entries(VALID)) {
    const paste = build();
    const view = ledgerLinkFixtureView(decodeImportPaste(paste));
    writeFileSync(join(OUT, `${name}.txt`), paste);
    writeFileSync(join(OUT, `${name}.json`), `${fmt(view)}\n`);
  }
  for (const [name, [code, build]] of Object.entries(INVALID)) {
    const paste = build();
    const got = codeOf(paste);
    if (got !== code)
      throw new Error(`${name}: expected ${code}, decoder gave ${got}`);
    writeFileSync(join(OUT, 'invalid', `${name}.txt`), paste);
    writeFileSync(join(OUT, 'invalid', `${name}.json`), `${fmt({ code })}\n`);
  }
  console.log(
    `wrote ${Object.keys(VALID).length} valid + ${Object.keys(INVALID).length} invalid fixtures to ${OUT}`,
  );
}

main();
