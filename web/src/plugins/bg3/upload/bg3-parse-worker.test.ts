/**
 * ROK-1960 — the worker entry always answers: if the handler's reply cannot be
 * posted (or the handler itself rejects), it posts a `code: null` failure so
 * the page terminates and recreates the worker instead of hanging.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bg3ParseReply, Bg3ParseRequest } from './bg3-parse-protocol';
import { replyToBg3Parse, type Bg3ParsePost } from './bg3-parse.worker';

// A plain function, not a vi.fn: vitest reports a spy's rejected return value against the running test.
let handle: (request: Bg3ParseRequest) => Promise<Bg3ParseReply> = () => Promise.resolve(OK_REPLY());
vi.mock('./bg3-parse-protocol', () => ({ handleBg3ParseRequest: (r: Bg3ParseRequest) => handle(r) }));

const REQUEST: Bg3ParseRequest = { id: 7, bytes: new ArrayBuffer(4) };
function OK_REPLY(): Bg3ParseReply {
    return { response: { id: 7, ok: true, inspection: { saveInfo: '{}', webp: null, thumbnail: null } }, transfer: [] };
}
const OK = OK_REPLY();

beforeEach(() => {
    handle = () => Promise.resolve(OK);
});

describe('replyToBg3Parse', () => {
    it('posts the handler reply with its transfer list', async () => {
        const post = vi.fn<Bg3ParsePost>();
        await replyToBg3Parse(REQUEST, post);
        expect(post.mock.calls).toEqual([[OK.response, []]]);
    });

    it('a reply that cannot be posted → a code:null failure for the same id', async () => {
        const post = vi.fn<Bg3ParsePost>().mockImplementationOnce(() => {
            throw new DOMException('could not be cloned', 'DataCloneError');
        });
        await replyToBg3Parse(REQUEST, post).catch(() => undefined);
        expect(post.mock.calls[1]).toEqual([{ id: 7, ok: false, code: null }, []]);
    });

    it('a handler that rejects → a code:null failure', async () => {
        handle = () => Promise.reject(new Error('boom'));
        const post = vi.fn<Bg3ParsePost>();
        await replyToBg3Parse(REQUEST, post).catch(() => undefined);
        expect(post.mock.calls).toEqual([[{ id: 7, ok: false, code: null }, []]]);
    });
});
