/**
 * Socket-handle audit helpers (ROK-1250).
 *
 * Reads `process._getActiveHandles()` to detect TCP sockets the kernel still
 * tracks after `closeTestApp()` returns. Used in two places:
 *   - `test-app.ts` `closeTestApp` — narrow fallback that destroys sockets
 *     bound to the test postgres container's port AFTER `_appClient.end()`
 *     resolves, in case the graceful FIN-ACK never completed (postgres-js
 *     calls `socket.end()` at its timeout cap, not `socket.destroy()`).
 *   - `integration-setup.ts` `afterAll` — opt-in audit guard (gated on
 *     `RL_TEST_SOCKET_HANDLE_AUDIT=true`) that fails the suite if more than
 *     a small empirical threshold of Socket handles linger after teardown.
 *
 * The audit threshold lives in `integration-setup.ts`; this module just
 * exposes the surface (list/parse/destroy).
 */
import type { Socket } from 'net';

/**
 * Parse the port from a postgres connection string.
 * Handles `postgres://user:pass@host:PORT/db[?...]` (IPv4/hostname form).
 * IPv6 hosts (`@[::1]:5432/`) are not currently emitted by Testcontainers
 * or our CI service config; revisit if that changes.
 */
export function extractPortFromConnectionString(s: string): number | null {
  const m = s.match(/@[^:/]+:(\d+)\//);
  return m ? Number(m[1]) : null;
}

/**
 * Return the subset of `process._getActiveHandles()` that are connected TCP
 * `Socket`s. Filters by `remotePort` being set — this excludes the ~29
 * stdio/IPC `Socket` wrappers that Jest workers always carry (fd 1/2/N with
 * `remotePort: undefined`). Mocks do NOT appear here — only handles libuv
 * tracks.
 */
export function listSocketHandles(): unknown[] {
  const proc = process as unknown as { _getActiveHandles?: () => unknown[] };
  return (proc._getActiveHandles?.() ?? []).filter((h: unknown) => {
    const ctorName = (h as { constructor?: { name?: string } })?.constructor
      ?.name;
    if (ctorName !== 'Socket') return false;
    // Only count TCP sockets with a remote endpoint — excludes stdio wrappers.
    return typeof (h as { remotePort?: unknown }).remotePort === 'number';
  });
}

/**
 * Destroy any tracked Socket bound to `port` (matched by `remotePort`).
 * Returns the count actually destroyed. Errors per-socket are intentionally
 * swallowed — at this point the test is over and we're cleaning up.
 */
export function destroySocketsOnPort(port: number): number {
  let destroyed = 0;
  for (const h of listSocketHandles()) {
    const sock = h as Socket;
    if (sock?.remotePort === port) {
      try {
        sock.destroy();
        destroyed += 1;
      } catch {
        // teardown — drop errors
      }
    }
  }
  return destroyed;
}
