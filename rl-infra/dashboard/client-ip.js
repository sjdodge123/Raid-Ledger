// Real client IP for per-IP limits (write rate/byte quotas, ROK-1900 approval
// read cap and auth-failure lockout).
//
// The public path is Cloudflare -> Traefik -> dashboard, so the socket peer of
// every browser request is Traefik. Keyed on the peer alone, every visitor
// shares one bucket and any stranger's 20 bad keys lock the operator out.
// So, ONLY when the immediate socket peer is a trusted proxy:
//   1. `CF-Connecting-IP` (Cloudflare's original-client header) when it is a
//      valid IP literal, else
//   2. X-Forwarded-For walked right-to-left, skipping trusted hops.
// From any other peer both headers are ignored — the peer IS the client, so a
// LAN client rotating CF-Connecting-IP while connecting directly is one bucket.
//
// Trusted proxies come from:
//   - RL_TRUSTED_PROXY_CIDRS: comma-separated IPs or CIDRs (e.g. 172.18.0.0/16).
//   - RL_TRUSTED_PROXY_HOSTS: comma-separated hostnames resolved via DNS at
//     boot and every minute (compose sets `traefik`, the service name on
//     rl-net, so Traefik's dynamic container IP is trusted with no operator
//     setting and env containers on rl-net are not).
// Both default to empty: nothing trusted, dev/local unchanged.
//
// Residual: Traefik also listens on the VM's :80/:443, so a LAN client that
// skips Cloudflare can send its own CF-Connecting-IP. That only moves it to a
// bucket of its choosing; valid header auth is never locked out
// (approvals-limits.js preGate), so it cannot lock the operator out.
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

const list = (raw) => String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);

// "::ffff:1.2.3.4" (IPv4-mapped peer on a dual-stack socket) -> "1.2.3.4".
const unmap = (ip) => (typeof ip === 'string' && /^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(ip) ? ip.slice(7) : ip);

const famOf = (ip) => (isIP(ip) === 6 ? 'ipv6' : 'ipv4');

// Per-client bucket maps (keyed by clientIp()) stay bounded in O(1): a Map
// keeps insertion order, so re-inserting moves the key to the newest end and,
// past `cap`, the least-recently-touched key (the first one) is dropped.
export const touchBucket = (map, key, value, cap) => {
  map.delete(key);
  map.set(key, value);
  if (map.size > cap) map.delete(map.keys().next().value);
};

export const parseTrusted = (raw) => {
  const literals = new Set();
  const blocks = new BlockList();
  for (const entry of list(raw)) {
    const [addr = '', bits] = entry.split('/');
    if (!isIP(addr)) continue;
    if (bits === undefined) { literals.add(unmap(addr)); continue; }
    const prefix = Number.parseInt(bits, 10);
    if (Number.isSafeInteger(prefix) && prefix >= 0) blocks.addSubnet(addr, prefix, famOf(addr));
  }
  return { literals, blocks };
};

const headerIp = (req, name) => {
  const v = req.headers?.[name];
  const s = typeof v === 'string' ? v.trim() : '';
  return isIP(s) ? s : null;
};

export const createClientIp = ({
  env = process.env, resolve = (h) => lookup(h, { all: true }), refreshMs = 60_000,
} = {}) => {
  const { literals, blocks } = parseTrusted(env.RL_TRUSTED_PROXY_CIDRS);
  const hosts = list(env.RL_TRUSTED_PROXY_HOSTS);
  let resolved = new Set();

  const trusted = (ip) => {
    const v = unmap(ip);
    if (!isIP(v)) return false;
    return literals.has(v) || resolved.has(v) || blocks.check(v, famOf(v));
  };

  const refresh = async () => {
    const next = new Set();
    for (const h of hosts) {
      try {
        for (const a of await resolve(h)) if (isIP(a?.address)) next.add(unmap(a.address));
      } catch { /* host not up yet: keep it untrusted until the next refresh */ }
    }
    resolved = next;
  };

  const clientIp = (req) => {
    const peer = req.socket?.remoteAddress || 'unknown';
    if (!trusted(peer)) return peer;
    const cf = headerIp(req, 'cf-connecting-ip');
    if (cf) return cf;
    const xff = req.headers?.['x-forwarded-for'];
    if (typeof xff !== 'string' || xff.length === 0) return peer;
    const hops = list(xff);
    for (let i = hops.length - 1; i >= 0; i -= 1) if (!trusted(hops[i])) return hops[i];
    // Every hop trusted: the peer, never a "trusted" identity as the client.
    return peer;
  };

  let timer = null;
  const start = () => {
    if (hosts.length === 0 || timer) return Promise.resolve();
    timer = setInterval(() => { refresh(); }, refreshMs);
    timer.unref?.();
    return refresh();
  };

  return Object.freeze({ clientIp, refresh, start, trusted });
};
