/**
 * The browser's own `fetch` and `XMLHttpRequest`, captured when this module
 * first loads (ROK-1754 §3.6).
 *
 * Third-party scripts (Wowhead tooltips.js) can replace `window.fetch` — or
 * `XMLHttpRequest` / its prototype methods — later, and would then see every
 * request's Authorization header and every response body. Anything that sends
 * the access token, or receives a token in its response, must call
 * `nativeFetch` (or the `nativeXhr` helpers), never the globals.
 *
 * XHR (review r3): the avatar upload needs XHR for upload progress, which
 * `fetch` cannot report. The constructor AND the prototype methods that carry
 * the token (`open`, `setRequestHeader`, `send`) are captured here, because a
 * script can patch the prototype without replacing the constructor. Residual:
 * a script that loads BEFORE this bundle could still have patched them; the
 * same is true of `fetch`, and our CSP/script order is the control there.
 *
 * Tests: MSW's XHR interceptor hands out Proxy instances that the captured
 * methods reject, so an XHR test captures from the pristine class (see
 * native-fetch.test.ts). Tests that stub `fetch` for a request routed through
 * here must install the stub before this module is imported (`vi.hoisted`),
 * or route the request through MSW.
 */
export const nativeFetch: typeof fetch = window.fetch.bind(window);

/** The `XMLHttpRequest` constructor as it was at module load. */
export const NativeXHR: typeof XMLHttpRequest = window.XMLHttpRequest;

const xhrProto = NativeXHR.prototype;
const xhrOpen = xhrProto.open;
const xhrSetRequestHeader = xhrProto.setRequestHeader;
const xhrSend = xhrProto.send;

/** Token-carrying XHR calls through the methods captured at module load. */
export const nativeXhr = {
  open(xhr: XMLHttpRequest, method: string, url: string): void {
    xhrOpen.call(xhr, method, url, true);
  },
  setRequestHeader(xhr: XMLHttpRequest, name: string, value: string): void {
    xhrSetRequestHeader.call(xhr, name, value);
  },
  send(xhr: XMLHttpRequest, body: XMLHttpRequestBodyInit | null): void {
    xhrSend.call(xhr, body);
  },
};
