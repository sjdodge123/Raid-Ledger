/**
 * ROK-1960 — dedicated module worker that runs the BG3 WASM reader off the
 * main thread, so a large save never freezes the page and a trapped instance
 * dies with the worker (the page terminates it; see `bg3-parse-client.ts`).
 */
import { handleBg3ParseRequest, type Bg3ParseRequest } from './bg3-parse-protocol';

self.onmessage = (event: MessageEvent<Bg3ParseRequest>) => {
    void handleBg3ParseRequest(event.data).then(({ response, transfer }) => self.postMessage(response, { transfer }));
};
