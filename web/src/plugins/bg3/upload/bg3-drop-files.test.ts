/**
 * ROK-1960 AC2 — a dropped folder: `readDroppedFiles` reads it one level deep,
 * `selectBg3SaveSource` insists on exactly one `.lsv`, and the campaign key is
 * the sha256 of the folder name (`save-folder`); a bare file is keyed by its
 * stem (`file-name`). The worker boundary is mocked; nothing else is.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    readDroppedFiles, type Bg3DropDirectoryEntry, type Bg3DropEntry, type Bg3DropFileEntry, type Bg3DropTransfer,
} from './bg3-drop-files';
import { Bg3ParseError, bg3ParseErrorMessage } from './bg3-parse-errors';
import { parseBg3Save, selectBg3SaveSource, sha256Hex } from './bg3-parse-save';
import type { Bg3SaveInspection } from './vendor/rl_collectors_web';

const inspectBg3SaveInWorker = vi.fn<(bytes: ArrayBuffer) => Promise<Bg3SaveInspection>>();
vi.mock('./bg3-parse-client', () => ({ inspectBg3SaveInWorker: (bytes: ArrayBuffer) => inspectBg3SaveInWorker(bytes) }));

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../packages/contract/companion/bg3-save/v1/fixtures');
const RAW = readFileSync(resolve(FIXTURES, 'saveinfo/act2-party-4p-summon.saveinfo.json'), 'utf8');
const FOLDER = 'Tav-1234__QuickSave_7';

const file = (name: string): File => new File([new Uint8Array([0x4c, 0x53, 0x50, 0x4b])], name);

function fileEntry(f: File): Bg3DropFileEntry {
    return { name: f.name, isFile: true, isDirectory: false, file: (ok) => ok(f) };
}

/** A directory whose reader yields `children` in one batch, then an empty one. */
function dirEntry(name: string, children: readonly Bg3DropEntry[]): Bg3DropDirectoryEntry {
    return {
        name, isFile: false, isDirectory: true,
        createReader: () => {
            let done = false;
            return { readEntries: (ok) => { ok(done ? [] : [...children]); done = true; } };
        },
    };
}

const dropOf = (entries: readonly Bg3DropEntry[], files: readonly File[] = []): Bg3DropTransfer => ({
    items: entries.map((entry) => ({ webkitGetAsEntry: () => entry })),
    files,
});

async function sourceOf(dt: Bg3DropTransfer) {
    const dropped = await readDroppedFiles(dt);
    return selectBg3SaveSource(dropped.files, dropped.folderName);
}

function messageOf(run: () => unknown): string {
    try {
        run();
    } catch (error) {
        if (error instanceof Bg3ParseError) return bg3ParseErrorMessage(error);
        throw error;
    }
    return 'no error';
}

beforeEach(() => {
    inspectBg3SaveInWorker.mockReset();
    inspectBg3SaveInWorker.mockResolvedValue({ saveInfo: RAW, webp: null, thumbnail: null });
});

describe('readDroppedFiles → selectBg3SaveSource → campaign key (ROK-1960 AC2)', () => {
    it('a folder with one .lsv → that save, keyed save-folder by sha256 of the folder name (never the raw name)', async () => {
        const save = file('QuickSave_7.lsv');
        const source = await sourceOf(dropOf([dirEntry(FOLDER, [fileEntry(save), fileEntry(file('QuickSave_7.WebP'))])]));
        expect(source).toEqual({ file: save, folderName: FOLDER });
        const { payload } = await parseBg3Save(source);
        expect(payload.campaignKeySource).toBe('save-folder');
        expect(payload.campaignKey).toBe(await sha256Hex(FOLDER));
        expect(JSON.stringify(payload)).not.toContain(FOLDER);
    });

    it('a folder with no .lsv → "Drop one save folder at a time."', async () => {
        const dropped = await readDroppedFiles(dropOf([dirEntry(FOLDER, [fileEntry(file('notes.txt'))])]));
        expect(messageOf(() => selectBg3SaveSource(dropped.files, dropped.folderName))).toBe('Drop one save folder at a time.');
    });

    it('a folder with two .lsv files → "Drop one save folder at a time."', async () => {
        const dropped = await readDroppedFiles(dropOf([dirEntry(FOLDER, [fileEntry(file('a.lsv')), fileEntry(file('b.lsv'))])]));
        expect(dropped.files).toHaveLength(2);
        expect(messageOf(() => selectBg3SaveSource(dropped.files, dropped.folderName))).toBe('Drop one save folder at a time.');
    });

    it('a bare .lsv → no folder name, keyed file-name by sha256 of its stem', async () => {
        const save = file(`${FOLDER}.lsv`);
        const source = await sourceOf(dropOf([fileEntry(save)], [save]));
        expect(source).toEqual({ file: save, folderName: null });
        const { payload } = await parseBg3Save(source);
        expect(payload.campaignKeySource).toBe('file-name');
        expect(payload.campaignKey).toBe(await sha256Hex(FOLDER));
    });

    it('no items (jsdom, some browsers) → the plain file list, no folder name', async () => {
        const save = file('QuickSave_7.lsv');
        expect(await readDroppedFiles({ files: [save] })).toEqual({ files: [save], folderName: null });
    });
});
