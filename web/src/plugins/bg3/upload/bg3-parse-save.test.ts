/**
 * ROK-1960 L1 — the browser parse layer with the worker boundary mocked. The
 * golden case feeds the contract's own `act2-party-4p-summon` raw
 * `SaveInfo.json` through the reader stub and expects the fixture payload,
 * so a drift in `normaliseBg3SaveInfo` (e.g. the summon rule) turns it red.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Bg3SavePayloadSchema } from '@raid-ledger/contract';
import { Bg3ParseError, bg3ParseErrorMessage, type Bg3ParseErrorCode } from './bg3-parse-errors';
import { BG3_SAVE_MAX_BYTES, parseBg3Save, selectBg3SaveSource, sha256Hex } from './bg3-parse-save';
import type { Bg3SaveInspection } from './vendor/rl_collectors_web';

const inspectBg3SaveInWorker = vi.fn<(bytes: ArrayBuffer) => Promise<Bg3SaveInspection>>();
vi.mock('./bg3-parse-client', () => ({ inspectBg3SaveInWorker: (bytes: ArrayBuffer) => inspectBg3SaveInWorker(bytes) }));

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../packages/contract/companion/bg3-save/v1/fixtures');
const RAW = readFileSync(resolve(FIXTURES, 'saveinfo/act2-party-4p-summon.saveinfo.json'), 'utf8');
const GOLDEN: unknown = JSON.parse(readFileSync(resolve(FIXTURES, 'act2-party-4p-summon.json'), 'utf8'));
const GOLDEN_PAYLOAD = Bg3SavePayloadSchema.parse((GOLDEN as { payload: unknown }).payload);
const MTIME = Date.parse('2026-10-24T12:00:00.000Z');

function must<T>(value: T | null | undefined, label: string): T {
    if (value === null || value === undefined) throw new Error(`missing ${label}`);
    return value;
}

function inspection(overrides: Partial<Bg3SaveInspection> = {}): Bg3SaveInspection {
    const ref = must(GOLDEN_PAYLOAD.thumbnail, 'golden thumbnail');
    const thumbnail = { sha256: ref.sha256, byteLength: ref.byteLength, width: ref.width, height: ref.height };
    return { saveInfo: RAW, webp: new Uint8Array(ref.byteLength).fill(7), thumbnail, ...overrides };
}

function lsv(name = 'QuickSave_1.lsv', size?: number): File {
    const file = new File([new Uint8Array([0x4c, 0x53, 0x50, 0x4b])], name, { lastModified: MTIME });
    if (size !== undefined) Object.defineProperty(file, 'size', { value: size });
    return file;
}

async function codeOf(promise: Promise<unknown>): Promise<Bg3ParseErrorCode> {
    const error: unknown = await promise.then(() => null, (e: unknown) => e);
    if (!(error instanceof Bg3ParseError)) throw new Error(`expected a Bg3ParseError, got ${String(error)}`);
    return error.code;
}

beforeEach(() => {
    inspectBg3SaveInWorker.mockReset().mockResolvedValue(inspection());
});

describe('parseBg3Save — golden', () => {
    it('produces the contract fixture payload for the act2 raw SaveInfo', async () => {
        const parsed = await parseBg3Save({ file: lsv(), folderName: 'Tav-1234__QuickSave_1' });
        expect(parsed.payload).toEqual({
            ...GOLDEN_PAYLOAD,
            savedAt: '2026-10-24T12:00:00.000Z',
            campaignKey: await sha256Hex('Tav-1234__QuickSave_1'),
            campaignKeySource: 'save-folder',
        });
        expect(parsed.webp?.byteLength).toBe(GOLDEN_PAYLOAD.thumbnail?.byteLength);
        expect(parsed.collectorVersion).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('passes the whole file to the reader and never the folder name', async () => {
        await parseBg3Save({ file: lsv(), folderName: 'Tav-1234__QuickSave_1' });
        expect(Array.from(new Uint8Array(must(inspectBg3SaveInWorker.mock.calls[0], 'call')[0]))).toEqual([0x4c, 0x53, 0x50, 0x4b]);
    });

    it('keys a dropped folder by sha256 of its name', async () => {
        const parsed = await parseBg3Save({ file: lsv(), folderName: 'X' });
        expect(parsed.payload.campaignKey).toBe('4b68ab3847feda7d6c62c1fbcbeebfa35eab7351ed5e78f4ddadea5df64b8015');
        expect(JSON.stringify(parsed.payload)).not.toContain('"X"');
    });

    it('keys a bare .lsv by its file stem, the same key its folder gives', async () => {
        const bare = await parseBg3Save({ file: lsv('Tav-1234__QuickSave_1.LSV'), folderName: null });
        expect(bare.payload.campaignKey).toBe(await sha256Hex('Tav-1234__QuickSave_1'));
    });

    it('drops the thumbnail when the reader returns none', async () => {
        inspectBg3SaveInWorker.mockResolvedValue(inspection({ webp: null, thumbnail: null }));
        const parsed = await parseBg3Save({ file: lsv(), folderName: 'X' });
        expect(parsed.payload.thumbnail).toBeNull();
        expect(parsed.webp).toBeNull();
    });
});

describe('parseBg3Save — error rows (spec section 7)', () => {
    it('rejects a file over the cap before reading it', async () => {
        expect(await codeOf(parseBg3Save({ file: lsv('a.lsv', BG3_SAVE_MAX_BYTES + 1), folderName: null }))).toBe('too_large');
        expect(inspectBg3SaveInWorker).not.toHaveBeenCalled();
    });

    it('passes a coded worker error through unchanged', async () => {
        inspectBg3SaveInWorker.mockRejectedValue(new Bg3ParseError('corrupt_package'));
        expect(await codeOf(parseBg3Save({ file: lsv(), folderName: 'X' }))).toBe('corrupt_package');
    });

    it('treats any other failure (e.g. an unreadable file) as reader_failed', async () => {
        inspectBg3SaveInWorker.mockRejectedValue(new DOMException('gone', 'NotReadableError'));
        expect(await codeOf(parseBg3Save({ file: lsv(), folderName: 'X' }))).toBe('reader_failed');
    });

    it('treats SaveInfo text that is not JSON as invalid_save_info', async () => {
        inspectBg3SaveInWorker.mockResolvedValue(inspection({ saveInfo: '{not json' }));
        expect(await codeOf(parseBg3Save({ file: lsv(), folderName: 'X' }))).toBe('invalid_save_info');
    });

    it('rejects a control-char save name as invalid_payload naming the field', async () => {
        const raw = { ...JSON.parse(RAW), 'Save Name': 'bad\u0007name' };
        inspectBg3SaveInWorker.mockResolvedValue(inspection({ saveInfo: JSON.stringify(raw) }));
        const error: unknown = await parseBg3Save({ file: lsv(), folderName: 'X' }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(Bg3ParseError);
        expect(error instanceof Bg3ParseError && error.code).toBe('invalid_payload');
        expect(error instanceof Bg3ParseError && error.detail).toMatch(/Save Name|saveName/);
    });
});

describe('selectBg3SaveSource', () => {
    it('picks the single .lsv out of a folder', () => {
        const save = lsv('Tav.lsv');
        expect(selectBg3SaveSource([new File(['x'], 'Tav.webp'), save], 'Tav')).toEqual({ file: save, folderName: 'Tav' });
    });

    it.each([[[]], [[lsv('a.lsv'), lsv('b.lsv')]]])('rejects a folder with 0 or >1 saves', (files) => {
        expect(() => selectBg3SaveSource(files, 'Tav')).toThrow(new Bg3ParseError('one_save_at_a_time'));
    });
});

describe('bg3ParseErrorMessage', () => {
    it('has plain copy for every code, with the issue path for invalid_payload', () => {
        expect(bg3ParseErrorMessage(new Bg3ParseError('reader_failed'))).toBe("Couldn't load the save reader. Reload and try again.");
        expect(bg3ParseErrorMessage(new Bg3ParseError('invalid_payload', 'party.0.level'))).toBe("This save can't be read (party.0.level).");
        expect(bg3ParseErrorMessage(new Bg3ParseError('not_a_save'))).toBe("This isn't a Baldur's Gate 3 save (.lsv).");
    });
});
