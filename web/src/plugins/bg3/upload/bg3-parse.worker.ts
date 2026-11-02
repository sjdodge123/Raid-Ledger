/**
 * ROK-1960 — dedicated module worker that runs the BG3 WASM reader off the
 * main thread, so a large save never freezes the page and a trapped instance
 * dies with the worker (the page terminates it; see `bg3-parse-client.ts`).
 */
import {
    handleBg3ParseRequest, type Bg3ParseRequest, type Bg3ParseResponse,
} from './bg3-parse-protocol';

export type Bg3ParsePost = (response: Bg3ParseResponse, transfer: Transferable[]) => void;

/**
 * Answer one request. Anything that escapes the handler (a failed
 * `postMessage`, e.g. a DataCloneError) still answers with a `code: null`
 * failure, so the page never waits forever and terminates + recreates the
 * worker as it does for a trap.
 */
export function replyToBg3Parse(request: Bg3ParseRequest, post: Bg3ParsePost): Promise<void> {
    return handleBg3ParseRequest(request)
        .then(({ response, transfer }) => post(response, transfer))
        .catch(() => post({ id: request.id, ok: false, code: null }, []));
}

self.onmessage = (event: MessageEvent<Bg3ParseRequest>) => {
    void replyToBg3Parse(event.data, (response, transfer) => self.postMessage(response, { transfer }));
};
