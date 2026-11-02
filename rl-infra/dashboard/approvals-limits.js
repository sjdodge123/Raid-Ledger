// ROK-1900 — abuse limits for the approvals inbox (server review MINOR 1–3).
//
//   - reads: GET/HEAD on /api/approvals* and /approvals-content/* are
//     rate-limited per client IP (the dispatcher's rateLimitOk only covers
//     writes, and is too tight for a page that polls every 5 s).
//   - failed auth: every 401/403 on an approval route counts against the IP
//     (an expired-but-genuine ?t= does not); past the cap the IP gets 429 on
//     every approval route until the window slides, so inbox-key guessing
//     (or ?t= forging) is throttled — except for a request carrying valid
//     header auth, which is never locked out.
//   - submits: at most `submitMax` in flight at once (each can buffer tens of
//     MB); the next gets 429 instead of piling more bodies into memory.
//
// Caps come from env (RL_APPROVAL_*) so tests can shrink them; defaults suit
// one operator plus a handful of agents.
import { touchBucket } from './client-ip.js';

const MAP_CAP = 10_000;

const intEnv = (v, d) => {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isSafeInteger(n) && n > 0 ? n : d;
};

// Sliding-window counter per key. hit() records and reports whether the key
// is still within `max`; over() only checks. At most `cap` keys, evicted
// least-recently-touched first in O(1) (client-ip.js touchBucket).
const windowCounter = (max, windowMs, now, cap) => {
  const buckets = new Map();
  const fresh = (key) => {
    const cutoff = now() - windowMs;
    const stamps = (buckets.get(key) ?? []).filter((t) => t > cutoff);
    if (stamps.length) touchBucket(buckets, key, stamps, cap);
    else buckets.delete(key);
    return stamps;
  };
  return {
    over: (key) => fresh(key).length >= max,
    hit: (key) => {
      const stamps = fresh(key);
      if (stamps.length >= max) return false;
      stamps.push(now());
      touchBucket(buckets, key, stamps, cap);
      return true;
    },
  };
};

export const createApprovalLimits = ({
  env = process.env, now = () => Date.now(), bucketCap = MAP_CAP,
} = {}) => {
  const reads = windowCounter(intEnv(env.RL_APPROVAL_READ_MAX, 240), 60_000, now, bucketCap);
  const fails = windowCounter(intEnv(env.RL_APPROVAL_AUTH_FAIL_MAX, 20), 10 * 60_000, now, bucketCap);
  const submitMax = intEnv(env.RL_APPROVAL_SUBMIT_CONCURRENCY, 2);
  let inFlight = 0;
  return Object.freeze({
    readOk: (ip) => reads.hit(ip ?? 'unknown'),
    lockedOut: (ip) => fails.over(ip ?? 'unknown'),
    recordFailure: (ip) => { fails.hit(ip ?? 'unknown'); },
    // Returns a release function, or null when the cap is reached.
    acquireSubmit: () => {
      if (inFlight >= submitMax) return null;
      inFlight += 1;
      let released = false;
      return () => { if (!released) { released = true; inFlight -= 1; } };
    },
  });
};

export const sendTooMany = (res, error, retryAfter) => {
  res.writeHead(429, {
    'content-type': 'application/json', 'cache-control': 'no-store', 'retry-after': String(retryAfter),
  });
  res.end(JSON.stringify({ ok: false, error }));
};

// Valid HEADER auth (inbox key or agent token). A 256-bit key carries no
// guessing risk, so its holder is never locked out by other clients' failures
// (several visitors can share one IP behind a proxy).
const headerAuthed = (auth, req) => Boolean(auth && (auth.isOperator(req) || auth.isAgent(req)));

// Shared gate for both approval handlers. Returns true when it already answered.
// The read cap runs FIRST, for everyone, per client IP (client-ip.js): a
// locked-out IP's guesses spend its read budget too, so it cannot try keys
// unthrottled and read 429-vs-200 as an oracle for the valid-auth exemption.
export const preGate = (limits, ip, req, res, auth = null) => {
  const isRead = req.method === 'GET' || req.method === 'HEAD';
  if (isRead && !limits.readOk(ip)) { sendTooMany(res, 'rate_limit_exceeded', 60); return true; }
  if (limits.lockedOut(ip) && !headerAuthed(auth, req)) {
    sendTooMany(res, 'too_many_auth_failures', 600);
    return true;
  }
  return false;
};

export const noteDenial = (limits, ip, status) => {
  if (status === 401 || status === 403) limits.recordFailure(ip);
};
