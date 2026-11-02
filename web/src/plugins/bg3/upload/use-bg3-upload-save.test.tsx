import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '../../../test/render-helpers';
import { server } from '../../../test/mocks/server';
import type { Bg3CrossHubMove } from '@raid-ledger/contract';
import { BG3_KEY_URL, bg3BindKeyCrossHubHandler, bg3BindKeyHandler } from '../../../test/mocks/bg3-handlers';
import { companionBg3MessageHandler, companionBlobHandler, type CompanionRefusal } from '../../../test/mocks/bg3-companion-handlers';
import { BG3_UPLOAD_KEY, BG3_UPLOAD_THUMB_SHA, buildBg3ParsedSave } from '../../../test/factories/bg3-upload';
import { bg3Keys } from '../hooks/bg3-keys';
import { Bg3UploadError } from './bg3-upload-errors';
import { uploadBg3Save, useBg3UploadSave, type Bg3UploadVars } from './use-bg3-upload-save';

const HUB_ID = 7;
const PICKED = 11;
const DEFAULT = 4;
const BLOB = `blob:${BG3_UPLOAD_THUMB_SHA.slice(0, 2)}`;
const bindTo = (id: number): string => `bind:${BG3_UPLOAD_KEY.slice(0, 2)}:{"campaignId":${id}}`;

/** Records every companion/bind call in order; `blob`/`message` pick the replies. */
function routes(opts: { blob?: 'stored' | CompanionRefusal; message?: 'accepted' | 'stale' | CompanionRefusal; bindStatus?: number } = {}) {
    const calls: string[] = [];
    const bodies: unknown[] = [];
    server.use(
        companionBlobHandler(opts.blob ?? 'stored', (c) => calls.push(`blob:${c.sha256.slice(0, 2)}`)),
        companionBg3MessageHandler(opts.message ?? 'accepted', (b) => { calls.push('message'); bodies.push(b); }),
        bg3BindKeyHandler((b, p) => calls.push(`bind:${String(p['campaignKey']).slice(0, 2)}:${JSON.stringify(b)}`)),
    );
    const bindStatus = opts.bindStatus;
    if (bindStatus !== undefined) {
        server.use(http.put(BG3_KEY_URL, () => {
            calls.push('bind:refused');
            return HttpResponse.json({ message: 'nope' }, { status: bindStatus });
        }));
    }
    return { calls, bodies };
}

const vars = (over: Partial<Bg3UploadVars> = {}): Bg3UploadVars => ({
    save: buildBg3ParsedSave(), campaignId: PICKED, ...over,
});

async function rejection(p: Promise<unknown>): Promise<Bg3UploadError> {
    const err: unknown = await p.then(() => null, (e: unknown) => e);
    if (err instanceof Bg3UploadError) return err;
    throw new Error(`expected a Bg3UploadError, got ${String(err)}`);
}

describe('uploadBg3Save (D-6)', () => {
    it('binds the key to the picked campaign, then PUTs the blob, then POSTs the message', async () => {
        const { calls } = routes();
        await expect(uploadBg3Save(vars())).resolves.toEqual({ status: 'uploaded', campaignId: PICKED });
        expect(calls).toEqual([bindTo(PICKED), BLOB, 'message']);
    });

    it('a failed bind sends nothing else: bind_failed, no blob, no message', async () => {
        const { calls } = routes({ bindStatus: 500 });
        expect((await rejection(uploadBg3Save(vars()))).code).toBe('bind_failed');
        expect(calls).toEqual(['bind:refused']);
    });

    it('sends only the summary: no position keys, no path strings', async () => {
        const { bodies } = routes();
        await uploadBg3Save(vars());
        const sent = JSON.stringify(bodies[0]);
        expect(sent).not.toMatch(/position|subregion/i);
        expect(sent).not.toMatch(/\\|Savegames|\.lsv/i);
    });

    it('skips the blob PUT without a thumbnail, and still binds when the pick is the server default', async () => {
        const { calls } = routes();
        await uploadBg3Save(vars({ save: buildBg3ParsedSave({ thumbnail: null }), campaignId: DEFAULT }));
        expect(calls).toEqual([bindTo(DEFAULT), 'message']);
    });

    it('reports a replayed save as already uploaded', async () => {
        routes({ message: 'stale' });
        await expect(uploadBg3Save(vars())).resolves.toEqual({ status: 'already_uploaded', campaignId: PICKED });
    });

    it('maps a 429 on the message to rate_limited', async () => {
        const { calls } = routes({ message: { status: 429, code: 'rate_limited' } });
        expect((await rejection(uploadBg3Save(vars()))).code).toBe('rate_limited');
        expect(calls).toEqual([bindTo(PICKED), BLOB, 'message']);
    });

    it('posts no message after a refused blob (the bind already ran)', async () => {
        const { calls } = routes({ blob: { status: 413, code: 'payload_too_large' } });
        const err = await rejection(uploadBg3Save(vars()));
        expect([err.code, err.detail]).toEqual(['server_refused', 'payload_too_large']);
        expect(calls).toEqual([bindTo(PICKED), BLOB]);
    });

    it('maps 404 unknown_contract to uploads_disabled', async () => {
        routes({ message: { status: 404, code: 'unknown_contract' } });
        expect((await rejection(uploadBg3Save(vars()))).code).toBe('uploads_disabled');
    });

    it('refuses thumbnail bytes that do not match the ref, before any request', async () => {
        const { calls } = routes();
        const save = { ...buildBg3ParsedSave(), webp: null };
        expect((await rejection(uploadBg3Save(vars({ save })))).code).toBe('invalid_payload');
        expect(calls).toEqual([]);
    });

    it('a 409 cross_hub_move stops after the bind with the body; confirmCrossHub re-binds with the flag', async () => {
        const move: Bg3CrossHubMove = { code: 'cross_hub_move', saveCount: 2, locations: [{ campaignId: 9, campaignName: 'A', hubId: 4, hubName: 'Other' }] };
        const calls: string[] = [];
        server.use(
            companionBlobHandler('stored', () => calls.push('blob')),
            companionBg3MessageHandler('accepted', () => calls.push('message')),
            bg3BindKeyCrossHubHandler(move, (b) => calls.push(`bind:${JSON.stringify(b)}`)),
        );
        const err = await rejection(uploadBg3Save(vars()));
        expect([err.code, err.move]).toEqual(['cross_hub_move', move]);
        expect(calls).toEqual([`bind:{"campaignId":${PICKED}}`]);
        await uploadBg3Save(vars({ confirmCrossHub: true }));
        expect(calls.slice(1)).toEqual([`bind:{"campaignId":${PICKED},"confirmCrossHub":true}`, 'blob', 'message']);
    });
});

describe('useBg3UploadSave', () => {
    it('invalidates the hub bg3 queries after an upload', async () => {
        routes();
        const qc = createTestQueryClient();
        qc.setQueryData(bg3Keys.snapshot(HUB_ID), null);
        const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
        const { result } = renderHook(() => useBg3UploadSave(HUB_ID), { wrapper });
        await act(() => result.current.mutateAsync(vars()));
        await waitFor(() => expect(qc.getQueryState(bg3Keys.snapshot(HUB_ID))?.isInvalidated).toBe(true));
    });
});
