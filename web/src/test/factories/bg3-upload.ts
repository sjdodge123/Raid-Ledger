/** ROK-1960 — a parsed BG3 save as the L1 parse layer hands it to the upload client. */
import type { Bg3SavePayload } from '@raid-ledger/contract';
import type { Bg3ParsedSave } from '../../plugins/bg3/upload/bg3-upload-api';

export const BG3_UPLOAD_KEY = 'ab'.repeat(32);
export const BG3_UPLOAD_THUMB_SHA = 'cd'.repeat(32);
/** Not a real WebP: the client never inspects the bytes, it only forwards them. */
export const BG3_UPLOAD_WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]);

export function buildBg3UploadPayload(overrides: Partial<Bg3SavePayload> = {}): Bg3SavePayload {
    return {
        saveName: 'QuickSave_1',
        savedAt: '2026-10-24T12:00:00Z',
        campaignKey: BG3_UPLOAD_KEY,
        campaignKeySource: 'save-folder',
        gameVersion: '4.1.1.7631656',
        platform: 'Steam',
        currentLevel: 'SCL_Main_A',
        difficulty: 'DifficultyHard',
        ruleset: 'RulesetLarian',
        party: [{
            origin: 'Generic', race: 'Elf_WoodElf', level: 8, xpLevel: 5630, xpTotal: 35630,
            classes: [{ main: 'Barbarian', sub: 'BerserkerPath' }], isSummon: false,
        }],
        thumbnail: {
            sha256: BG3_UPLOAD_THUMB_SHA, byteLength: BG3_UPLOAD_WEBP.byteLength,
            contentType: 'image/webp', width: 320, height: 180,
        },
        ...overrides,
    };
}

/** With a thumbnail by default; `{ thumbnail: null }` drops both the ref and the bytes. */
export function buildBg3ParsedSave(overrides: Partial<Bg3SavePayload> = {}): Bg3ParsedSave {
    const payload = buildBg3UploadPayload(overrides);
    return { payload, webp: payload.thumbnail === null ? null : BG3_UPLOAD_WEBP, collectorVersion: '0.1.0' };
}
