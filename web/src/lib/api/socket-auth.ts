import { getAccessToken } from './access-token-store';

/**
 * ROK-1754 §3.6: socket.io `auth` in its CALLBACK form, so every handshake
 * (the first connect AND each reconnect) sends the token held in memory at
 * that moment — a static `{ token }` re-sent a stale one after the 1h expiry.
 * The gateways validate on connection only (`handleConnection`).
 */
export function socketAuth(cb: (data: object) => void): void {
  const token = getAccessToken();
  cb(token ? { token } : {});
}
