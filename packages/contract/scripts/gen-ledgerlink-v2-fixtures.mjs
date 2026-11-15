// Generates packages/contract/ledgerlink/v2/fixtures/ (ROK-2184).
//
//   node packages/contract/scripts/gen-ledgerlink-v2-fixtures.mjs
//
// 1. Every VALID v1 golden fixture re-encoded as its v2 twin: each `!RL1!`
//    token is inflated, its payload `schema` set to 2, re-deflated and
//    re-wrapped as `!RL2!`; the `.json` view only changes `"schema": 1` → 2.
//    The v1 folder is read, never written (it is frozen).
// 2. New synthetic `loot` fixtures (no real names, GUIDs or guilds — the
//    identity is the v1 fixture builder's invented "Ana Forever").
// The `.json` view of a loot token is the payload verbatim. The api fixture
// generator (api/scripts/gen-ledgerlink-fixtures.ts) may take this over once
// the real decoder reads v2; it must then produce byte-identical output or
// update these files in the same PR.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'ledgerlink');
const V1 = join(root, 'v1', 'fixtures');
const OUT = join(root, 'v2', 'fixtures');
const TOKEN_RE = /!RL1!([a-z]+(?:-\d+of\d+)?)!([A-Za-z0-9+/]+={0,2})/g;
const EXPORTED_AT = 1_790_000_000;
const DAY = 86_400;

const encode = (payload, header) =>
    `!RL${header.version ?? 2}!${header.section}${header.page ?? ''}!${deflateSync(Buffer.from(JSON.stringify(payload), 'utf8')).toString('base64')}`;
const decode = (body) => JSON.parse(inflateSync(Buffer.from(body, 'base64')).toString('utf8'));

function reencodeToken(_match, head, body) {
    const payload = decode(body);
    payload.schema = 2;
    return `!RL2!${head}!${deflateSync(Buffer.from(JSON.stringify(payload), 'utf8')).toString('base64')}`;
}

function write(name, txt, view) {
    writeFileSync(join(OUT, `${name}.txt`), txt.endsWith('\n') ? txt : `${txt}\n`);
    writeFileSync(join(OUT, `${name}.json`), typeof view === 'string' ? view : `${JSON.stringify(view, null, 2)}\n`);
}

mkdirSync(join(OUT, 'invalid'), { recursive: true });

// ---- 1. v2 twins of every valid v1 fixture ----
for (const file of readdirSync(V1).filter((f) => f.endsWith('.txt')).sort()) {
    const name = file.slice(0, -4);
    const txt = readFileSync(join(V1, file), 'utf8').replace(TOKEN_RE, reencodeToken);
    const view = readFileSync(join(V1, `${name}.json`), 'utf8').replaceAll('"schema": 1,', '"schema": 2,');
    write(name, txt, view);
}

// ---- 2. loot ----
const raidV1 = decode(readFileSync(join(V1, 'raid.txt'), 'utf8').trim().split('!')[3]);
const envelope = {
    schema: 2,
    addonVersion: raidV1.addonVersion,
    client: raidV1.client,
    exportedAt: EXPORTED_AT,
    who: raidV1.who,
};
const drop = (i, extra = {}) => ({
    at: EXPORTED_AT - 3 * DAY + i * 300,
    itemId: 16800 + i,
    quantity: 1,
    quality: 4,
    looterName: i % 2 === 0 ? 'Ana Forever' : 'Lootero',
    ...(i % 2 === 0 ? { looterGuid: 'Player-4395-0ABCDEF0' } : { looterGuid: 'Player-4395-00000002' }),
    method: 'master',
    instanceId: 409,
    difficultyId: 9,
    encounterId: 663,
    encounterName: 'Lucifron',
    ...extra,
});
const lootPayload = (drops, data = {}) => ({
    ...envelope,
    section: 'loot',
    data: { windowStart: EXPORTED_AT - 30 * DAY, windowEnd: EXPORTED_AT, minQuality: 2, drops, ...data },
});

const loot = lootPayload([
    drop(0),
    drop(1, { method: 'roll' }),
    // Trash drop: no boss attribution, a stack, no GUID (looter not in the roster).
    { at: EXPORTED_AT - 2 * DAY, itemId: 12360, quantity: 3, looterName: 'Lootera-Testrealm', method: 'direct', instanceId: 409, difficultyId: 9 },
    drop(3, { link: '|cffa335ee|Hitem:16803::::::::60:::::|h[Example Boots]|h|r', method: 'unknown' }),
]);
const lootToken = encode(loot, { section: 'loot' });
write('loot', lootToken, { pages: 1, payload: loot });

const empty = lootPayload([]);
write('loot-empty-window', encode(empty, { section: 'loot' }), { pages: 1, payload: empty });

// Mixed "Export all": the shuffled v1 mixed fixture's v2 twin + one loot token.
const mixed = JSON.parse(readFileSync(join(OUT, 'mixed-char-guild3-raid-shuffled.json'), 'utf8'));
mixed.sections.push({ section: 'loot', pages: 1, payload: loot });
const mixedTxt = readFileSync(join(OUT, 'mixed-char-guild3-raid-shuffled.txt'), 'utf8').trimEnd();
write('mixed-char-guild3-raid-loot', `${lootToken}\n${mixedTxt}`, mixed);

// ---- invalid ----
const bad = (name, txt, code) => write(join('invalid', name), txt, { code });
bad('loot-too-many-drops', encode(lootPayload(Array.from({ length: 501 }, (_, i) => drop(i % 400))), { section: 'loot' }), 'INVALID_PAYLOAD');
bad('loot-unknown-key', encode(lootPayload([drop(0, { roll: 87 })]), { section: 'loot' }), 'INVALID_PAYLOAD');
bad('loot-drop-outside-window', encode(lootPayload([drop(0, { at: EXPORTED_AT + 60 })]), { section: 'loot' }), 'INVALID_PAYLOAD');
bad('loot-encounter-name-without-id', encode(lootPayload([drop(0, { encounterId: undefined })]), { section: 'loot' }), 'INVALID_PAYLOAD');
bad('loot-paged', [1, 2].map((n) => encode(lootPayload([drop(n)]), { section: 'loot', page: `-${n}of2` })).join('\n'), 'BAD_HEADER');
bad('loot-two-tokens', `${lootToken}\n${encode(lootPayload([drop(1)]), { section: 'loot' })}`, 'PAGES_INCOMPLETE');
bad('v1-loot-section', encode({ ...loot, schema: 1 }, { section: 'loot', version: 1 }), 'BAD_HEADER');
const v1Raid = readFileSync(join(V1, 'raid.txt'), 'utf8').trim();
bad('mixed-v1-v2', `${v1Raid}\n${lootToken}`, 'UNSUPPORTED_VERSION');
// Header says v2, body says schema 1 — same string as v1 invalid/unsupported-version.
bad('v2-header-schema-1', readFileSync(join(V1, 'invalid', 'unsupported-version.txt'), 'utf8'), 'UNSUPPORTED_VERSION');
bad('unsupported-version', encode({ ...raidV1, schema: 3 }, { section: 'raid', version: 3 }), 'UNSUPPORTED_VERSION');

console.log(`wrote ${readdirSync(OUT).length - 1} files + invalid/ to ${OUT}`);
