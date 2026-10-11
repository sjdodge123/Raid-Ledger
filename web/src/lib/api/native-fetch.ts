/**
 * The browser's own `fetch`, captured when this module first loads (ROK-1754 §3.6).
 *
 * Third-party scripts (Wowhead tooltips.js) can replace `window.fetch` later and
 * would then see every request's Authorization header and every response body.
 * Anything that sends the access token, or receives a token in its response, must
 * call `nativeFetch`, never the global `fetch`.
 *
 * Tests that stub `fetch` for a request routed through here must install the stub
 * before this module is imported (`vi.hoisted`), or route the request through MSW.
 */
export const nativeFetch: typeof fetch = window.fetch.bind(window);
