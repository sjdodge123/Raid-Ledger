/**
 * ROK-1960 — the worker entry always answers: if the handler's reply cannot be
 * posted (or the handler itself rejects), it posts a `code: null` failure so
 * the page terminates and recreates the worker instead of hanging.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bg3ParseReply, Bg3ParseRequest } from './bg3-parse-protocol';
import { replyToBg3Parse, type Bg3ParsePost } from './bg3-parse.worker';

const handleBg3ParseRequest = vi.fn<(request: Bg3ParseRequest) => Promise<Bg3ParseReply>>();
vi.mock('./bg3-parse-protocol', () => ({ handleBg3ParseRequest: (r: Bg3ParseRequest) => handleBg3ParseRequest(r) }));

const REQUEST: Bg3ParseRequest = { id: 7, bytes: new ArrayBuffer(4) };
const OK: Bg3ParseReply = {
    response: { id: 7, ok: true, inspection: { saveInfo: '{}', webp: null, thumbnail: null } },
    transfer: [],
};

beforeEach(() => handleBg3ParseRequest.mockReset());

describe('replyToBg3Parse', () => {
    it('posts the handler reply with its transfer list', async () => {
        handleBg3ParseRequest.mockResolvedValue(OK);
        const post = vi.fn<Bg3ParsePost>();
        await replyToBg3Parse(REQUEST, post);
        expect(post.mock.calls).toEqual([[OK.response, []]]);
    });

    it('a reply that cannot be posted → a code:null failure for the same id', async () => {
        handleBg3ParseRequest.mockResolvedValue(OK);
        const post = vi.fn<Bg3ParsePost>().mockImplementationOnce(() => {
            throw new DOMException('could not be cloned', 'DataCloneError');
        });
        await replyToBg3Parse(REQUEST, post).catch(() => undefined);
        expect(post.mock.calls[1]).toEqual([{ id: 7, ok: false, code: null }, []]);
    });

    it('a handler that rejects → a code:null failure', async () => {
        handleBg3ParseRequest.mockRejectedValue(new Error('boom'));
        const post = vi.fn<Bg3ParsePost>();
        await replyToBg3Parse(REQUEST, post).catch(() => undefined);
        expect(post.mock.calls).toEqual([[{ id: 7, ok: false, code: null }, []]]);
    });
});
