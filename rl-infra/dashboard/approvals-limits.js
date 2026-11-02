// ROK-1900 — abuse limits for the approvals inbox (server review MINOR 1–3).
//
//   - reads: GET/HEAD on /api/approvals* and /approvals-content/* are
//     rate-limited per client IP (the dispatcher's rateLimitOk only covers
//     writes, and is too tight for a page that polls every 5 s).
//   - failed auth: every 401/403 on an approval route counts against the IP;
//     past the cap the IP gets 429 on every approval route until the window
//     slides, so inbox-key guessing (or ?t= forging) is throttled.
//   - submits: at most `submitMax` in flight at once (each can buffer tens of
//     MB); the next gets 429 instead of piling more bodies into memory.
//
// Caps come from env (RL_APPROVAL_*) so tests can shrink them; defaults suit
// one operator plus a handful of agents.
const MAP_CAP = 10_000;

const intEnv = (v, d) => {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isSafeInteger(n) && n > 0 ? n : d;
};

// Sliding-window counter per key. hit() records and reports whether the key
// is still within `max`; over() only checks.
const windowCounter = (max, windowMs, now) => {
  const buckets = new Map();
  const fresh = (key) => {
    const cutoff = now() - windowMs;
    const stamps = (buckets.get(key) ?? []).filter((t) => t > cutoff);
    buckets.set(key, stamps);
    return stamps;
  };
  const sweep = () => {
    if (buckets.size <= MAP_CAP) return;
    for (const k of [...buckets.keys()]) if (fresh(k).length === 0) buckets.delete(k);
  };
  return {
    over: (key) => fresh(key).length >= max,
    hit: (key) => {
      const stamps = fresh(key);
      if (stamps.length >= max) return false;
      stamps.push(now());
      sweep();
      return true;
    },
  };
};

export const createApprovalLimits = ({
  env = process.env, now = () => Date.now(),
} = {}) => {
  const reads = windowCounter(intEnv(env.RL_APPROVAL_READ_MAX, 240), 60_000, now);
  const fails = windowCounter(intEnv(env.RL_APPROVAL_AUTH_FAIL_MAX, 20), 10 * 60_000, now);
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

// Shared gate for both approval handlers. Returns true when it already answered.
export const preGate = (limits, ip, req, res) => {
  if (limits.lockedOut(ip)) { sendTooMany(res, 'too_many_auth_failures', 600); return true; }
  const isRead = req.method === 'GET' || req.method === 'HEAD';
  if (isRead && !limits.readOk(ip)) { sendTooMany(res, 'rate_limit_exceeded', 60); return true; }
  return false;
};

export const noteDenial = (limits, ip, status) => {
  if (status === 401 || status === 403) limits.recordFailure(ip);
};
