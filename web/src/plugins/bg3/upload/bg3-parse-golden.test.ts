/**
 * ROK-1960 L4a — the golden test (spec §9 L1) with NOTHING mocked below the
 * worker boundary: the committed synthetic `.lsv` goes through the REAL
 * vendored WASM reader (`handleBg3ParseRequest` → `loadBg3Wasm`), the
 * contract's `normaliseBg3SaveInfo` and `Bg3SavePayloadSchema`. Only the
 * `Worker` hop itself is replaced by a direct call to the worker's handler.
 *
 * The fixture and `synthetic-act2.expected.json` were produced by the
 * rl-companion reader at e767eadf (writer.rs; no real save data). Flipping
 * the normaliser's summon rule turns the party golden red.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Bg3SavePayloadSchema } from '@raid-ledger/contract';
import { handleBg3ParseRequest } from './bg3-parse-protocol';
import { Bg3ParseError } from './bg3-parse-errors';
import { parseBg3Save, sha256Hex, type Bg3SaveSource } from './bg3-parse-save';
import { initSync } from './vendor/rl_collectors_web';

vi.mock('./bg3-parse-client', async () => {
    const { handleBg3ParseRequest: handle } =
        await import('./bg3-parse-protocol');
    return {
        inspectBg3SaveInWorker: async (bytes: ArrayBuffer) => {
            const { response } = await handle({ id: 1, bytes });
            if (!response.ok)
                throw new Error(`reader failed: ${String(response.code)}`);
            return response.inspection;
        },
    };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const LSV = readFileSync(resolve(HERE, 'fixtures/synthetic-act2.lsv'));
const EXPECTED = JSON.parse(
    readFileSync(
        resolve(HERE, 'fixtures/synthetic-act2.expected.json'),
        'utf8',
    ),
) as {
    saveInfo: string;
    thumbnail: {
        sha256: string;
        byteLength: number;
        width: number;
        height: number;
    };
};
const MTIME = Date.parse('2026-10-24T12:00:00.000Z');

/** A fresh copy each time: the parse path transfers (detaches) the buffer. */
const lsvBytes = (): ArrayBuffer => new Uint8Array(LSV).buffer;
const lsvFile = (name = 'QuickSave_1.lsv'): File =>
    new File([new Uint8Array(LSV)], name, { lastModified: MTIME });

const member = (
    origin: string,
    race: string,
    level: number,
    xp: [number, number],
    classes: [string, string][],
) => ({
    origin,
    race,
    level,
    xpLevel: xp[0],
    xpTotal: xp[1],
    classes: classes.map(([main, sub]) => ({ main, sub })),
    isSummon: false,
});

/** The party, in save order; the class-less familiar is the summon. */
const GOLDEN_PARTY = [
    member(
        'Generic',
        'Elf_WoodElf',
        8,
        [5630, 35630],
        [['Barbarian', 'BerserkerPath']],
    ),
    {
        origin: 'DogFamiliar_Scratch_Summon',
        race: 'Beast',
        level: 1,
        xpLevel: 0,
        xpTotal: 0,
        classes: [],
        isSummon: true,
    },
    member(
        'Generic',
        'Human',
        8,
        [5590, 35590],
        [['Wizard', 'NecromancySchool']],
    ),
    member(
        'Generic',
        'Duergar',
        8,
        [5390, 35390],
        [
            ['Ranger', 'GloomStalker'],
            ['Rogue', 'Thief'],
        ],
    ),
    member(
        'Generic',
        'Tiefling_Asmodeus',
        8,
        [5630, 35630],
        [['Paladin', 'Vengeance']],
    ),
];

/**
 * The parse result as a value, so a drifted normaliser (whose output the
 * schema then rejects as `invalid_payload`) fails the golden's own `toEqual`
 * with a diff instead of an uncaught throw.
 */
async function outcome(source: Bg3SaveSource) {
    try {
        const parsed = await parseBg3Save(source);
        const schemaValid = Bg3SavePayloadSchema.safeParse(parsed.payload).success;
        return { ok: true as const, schemaValid, payload: parsed.payload, webpBytes: parsed.webp?.byteLength ?? null };
    } catch (error) {
        if (!(error instanceof Bg3ParseError)) throw error;
        return { ok: false as const, code: error.code, detail: error.detail };
    }
}

beforeAll(() => {
    // jsdom cannot fetch the `.wasm` by URL; instantiate the vendored bytes once,
    // so the reader's own `init()` (inside loadBg3Wasm) finds it ready.
    initSync({
        module: readFileSync(resolve(HERE, 'vendor/rl_collectors_web_bg.wasm')),
    });
});

describe('the real WASM reader on the synthetic Act 2 save', () => {
    it('handleBg3ParseRequest returns the SaveInfo + thumbnail the rl-companion reader produced', async () => {
        const { response } = await handleBg3ParseRequest({
            id: 7,
            bytes: lsvBytes(),
        });
        if (!response.ok)
            throw new Error(`expected ok, got code ${String(response.code)}`);
        expect(response.inspection.saveInfo).toBe(EXPECTED.saveInfo);
        expect(response.inspection.thumbnail).toEqual(EXPECTED.thumbnail);
        const webp = response.inspection.webp;
        if (!webp) throw new Error('expected a WebP thumbnail');
        expect(webp.byteLength).toBe(EXPECTED.thumbnail.byteLength);
    });

    it('a bare .lsv → a schema-valid payload matching the golden (file-name key, summon rule)', async () => {
        expect(await outcome({ file: lsvFile(), folderName: null })).toEqual({
            ok: true,
            schemaValid: true,
            payload: {
                saveName: 'QuickSave_1',
                savedAt: '2026-10-24T12:00:00.000Z',
                campaignKey: await sha256Hex('QuickSave_1'),
                campaignKeySource: 'file-name',
                gameVersion: '4.1.1.7631656',
                platform: 'Steam',
                currentLevel: 'SCL_Main_A',
                difficulty: 'DifficultyHard',
                ruleset: 'RulesetLarian',
                party: GOLDEN_PARTY,
                thumbnail: { ...EXPECTED.thumbnail, contentType: 'image/webp' },
            },
            webpBytes: EXPECTED.thumbnail.byteLength,
        });
    });

    it('a dropped folder → campaignKey is the folder-name hash, source save-folder', async () => {
        const result = await outcome({ file: lsvFile(), folderName: 'Tav-1234__QuickSave_1' });
        const key = result.ok ? [result.payload.campaignKey, result.payload.campaignKeySource] : result;
        expect(key).toEqual([await sha256Hex('Tav-1234__QuickSave_1'), 'save-folder']);
    });
});
