import { afterEach, describe, expect, it, vi } from 'vitest';
import { Bg3SaveMessageSchema } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { companionBlobHandler, type CompanionBlobCall } from '../../../test/mocks/bg3-companion-handlers';
import { BG3_UPLOAD_THUMB_SHA, BG3_UPLOAD_WEBP, buildBg3ParsedSave } from '../../../test/factories/bg3-upload';
import { BG3_WEB_APP_VERSION_FALLBACK, buildBg3SaveMessage, putBg3Thumbnail, webAppVersion } from './bg3-upload-api';
import { Bg3UploadError, bg3UploadErrorMessage, toBg3UploadError } from './bg3-upload-errors';
import { withErrorBody, withHttpStatus } from '../../../lib/api/api-error';

const NOW = Date.parse('2026-10-30T09:15:42.123Z');

function thrown(fn: () => unknown): Bg3UploadError {
    try {
        fn();
    } catch (error) {
        if (error instanceof Bg3UploadError) return error;
        throw error;
    }
    throw new Error('expected a Bg3UploadError');
}

describe('buildBg3SaveMessage', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('wraps the payload in a bg3-save v1 envelope captured now (D-7)', () => {
        const msg = buildBg3SaveMessage(buildBg3ParsedSave(), NOW);
        expect(Bg3SaveMessageSchema.safeParse(msg).success).toBe(true);
        expect(msg).toMatchObject({
            envelopeVersion: 1, contract: 'bg3-save', contractVersion: 1,
            capturedAt: '2026-10-30T09:15:42.123Z', collectorVersion: '0.1.0',
        });
        expect(msg.payload.savedAt).toBe('2026-10-24T12:00:00Z');
    });

    it('clamps a future file mtime to capturedAt', () => {
        const msg = buildBg3SaveMessage(buildBg3ParsedSave({ savedAt: '2026-11-02T00:00:00Z' }), NOW);
        expect(msg.payload.savedAt).toBe(msg.capturedAt);
    });

    it('refuses a payload the contract rejects, naming the field', () => {
        const err = thrown(() => buildBg3SaveMessage(buildBg3ParsedSave({ saveName: 'Quick\u0007Save' }), NOW));
        expect(err.code).toBe('invalid_payload');
        expect(err.detail).toBe('payload.saveName');
        expect(bg3UploadErrorMessage(err)).toBe("This save can't be read (payload.saveName).");
    });

    it('uses the web build version, or the fallback when the build defines none', () => {
        expect(webAppVersion()).toBe(BG3_WEB_APP_VERSION_FALLBACK);
        vi.stubGlobal('__APP_VERSION__', '1.1.0');
        expect(buildBg3SaveMessage(buildBg3ParsedSave(), NOW).appVersion).toBe('1.1.0');
        vi.stubGlobal('__APP_VERSION__', 'dev build');
        expect(webAppVersion()).toBe(BG3_WEB_APP_VERSION_FALLBACK);
    });
});

describe('putBg3Thumbnail', () => {
    it('PUTs the raw WebP bytes to the content-addressed blob route', async () => {
        const calls: CompanionBlobCall[] = [];
        server.use(companionBlobHandler('stored', (c) => calls.push(c)));
        await expect(putBg3Thumbnail(BG3_UPLOAD_THUMB_SHA, BG3_UPLOAD_WEBP)).resolves.toEqual({
            status: 'stored', sha256: BG3_UPLOAD_THUMB_SHA,
        });
        expect(calls).toHaveLength(1);
        expect(calls[0]?.contentType).toBe('image/webp');
        expect(Array.from(calls[0]?.bytes ?? [])).toEqual(Array.from(BG3_UPLOAD_WEBP));
    });
});

describe('toBg3UploadError', () => {
    const httpError = (status: number, code?: string) =>
        withErrorBody(withHttpStatus(new Error('x'), status), code ? { code, message: code } : {});

    it.each([
        [401, 'unauthorized', 'session_expired', null],
        [404, 'unknown_contract', 'uploads_disabled', null],
        [429, 'rate_limited', 'rate_limited', null],
        [413, 'payload_too_large', 'server_refused', 'payload_too_large'],
        [422, 'invalid_payload', 'server_refused', 'invalid_payload'],
        [500, undefined, 'upload_failed', null],
    ] as const)('maps %i %s to %s', (status, code, expected, detail) => {
        const err = toBg3UploadError(httpError(status, code));
        expect(err.code).toBe(expected);
        expect(err.detail).toBe(detail);
    });

    it('says to try again in a minute on 429', () => {
        expect(bg3UploadErrorMessage(new Bg3UploadError('rate_limited'))).toBe('Too many uploads. Try again in a minute.');
    });
});
