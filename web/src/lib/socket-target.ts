/**
 * socket.io connection-target resolution (ROK-1533).
 *
 * `VITE_API_URL` is an ORIGIN in local dev (`http://localhost:3000`) but a
 * PATH on every nginx-fronted deployment — `/api` in `Dockerfile.allinone`,
 * `Dockerfile` and `web/Dockerfile`, i.e. production, the allinone container
 * and every rl-infra fleet env.
 *
 * ``io(`${API_BASE}/lineups`)`` only works for the first form. socket.io-client
 * resolves a leading-slash uri against `location`, then treats the WHOLE path
 * of the resolved URL as the NAMESPACE while keeping its default `/socket.io`
 * engine path. With `API_BASE=/api` the browser therefore asks for namespace
 * `/api/lineups` (the server only registers `/lineups`) over
 * `https://<host>/socket.io/` — a path nginx answers with the SPA's
 * index.html, so the engine.io handshake dies before the namespace is even
 * reached. The socket never connects and every live-refresh feature silently
 * degrades to whatever REST had already cached.
 *
 * Splitting the two apart fixes it: the namespace stays bare and the API
 * prefix moves onto the engine.io `path`.
 */
export interface SocketTarget {
  /** First argument to `io()` — origin + namespace, or a bare namespace. */
  url: string;
  /** engine.io request path (the `path` option of `io()`). */
  path: string;
}

/**
 * Resolve the `io()` url + engine path for a gateway namespace.
 *
 * @param namespace - Gateway namespace, leading slash included (`/lineups`).
 * @param apiBase - API base; defaults to the build-time `VITE_API_URL`.
 * @returns The `io()` target url and its engine.io path.
 */
export function resolveSocketTarget(
  namespace: string,
  apiBase: string = import.meta.env.VITE_API_URL || 'http://localhost:3000',
): SocketTarget {
  const base = apiBase.trim().replace(/\/+$/, '');
  if (!base) return { url: namespace, path: '/socket.io' };

  // Path-mounted API behind a reverse proxy (`/api`): keep the namespace
  // clean and move the prefix onto the engine.io path instead.
  const isAbsolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(base) || base.startsWith('//');
  if (!isAbsolute) {
    const prefix = base.startsWith('/') ? base : `/${base}`;
    return { url: namespace, path: `${prefix}/socket.io` };
  }

  // An absolute base may ALSO carry a path prefix (`https://host/api` — a
  // deployer can set exactly that, `web/Dockerfile` exposes VITE_API_URL as a
  // build arg). Splitting origin from prefix keeps that case correct too.
  try {
    const parsed = new URL(base.startsWith('//') ? `https:${base}` : base);
    const prefix = parsed.pathname.replace(/\/+$/, '');
    const origin = base.startsWith('//') ? `//${parsed.host}` : parsed.origin;
    return { url: `${origin}${namespace}`, path: `${prefix}/socket.io` };
  } catch {
    return { url: `${base}${namespace}`, path: '/socket.io' };
  }
}
