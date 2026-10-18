// ROK-1847 — authorization for the test-plan routes.
//
// The dashboard is routed publicly (Traefik `HostRegexp(^fleet\..+$)`), and
// test-plan verdicts are the UI-verification merge gate, so every write is
// gated here:
//   - agent-only (plan PUT/POST, both DELETEs): a matching X-Agent-Token.
//     Fails closed — 503 when RL_AGENT_TOKEN is unset, 401 otherwise.
//   - tester writes (submit, step result, comment, reset, attachment): the
//     agent token, OR the plan's own random tester token (minted at create
//     and carried in the shared plan link as `?k=`).
//
// No header is ever a credential (Codex c1). An earlier "LAN host" shortcut
// trusted `Host: fleet.rl.lan`, which any container on rl-net could send
// straight to rl-dashboard:8080 (or via Traefik). It is gone: LAN testers
// use `tester_url_lan`, which carries the same `k` token.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const digest = (s) => createHash('sha256').update(s, 'utf8').digest();

// Constant-time compare over SHA-256 digests, so neither the content nor
// the length of the expected token leaks through timing.
export const tokenMatches = (presented, expected) => {
  if (typeof expected !== 'string' || expected.length === 0) return false;
  if (typeof presented !== 'string' || presented.length === 0) return false;
  return timingSafeEqual(digest(presented), digest(expected));
};

const header = (req, name) => {
  const v = req?.headers?.[name];
  return typeof v === 'string' ? v : undefined;
};

export const agentTokenOk = (req, agentToken) =>
  tokenMatches(header(req, 'x-agent-token'), agentToken);

export const mintTesterToken = () => randomBytes(24).toString('base64url');

// Returns null when the request may proceed, else { status, error }.
export const agentDenial = (req, agentToken) => {
  if (!agentToken) return { status: 503, error: 'agent_token_unconfigured' };
  if (!agentTokenOk(req, agentToken)) return { status: 401, error: 'agent_token_required' };
  return null;
};

export const testerAllowed = (req, plan, agentToken) =>
  agentTokenOk(req, agentToken)
  || tokenMatches(header(req, 'x-tester-token'), plan?.tester_token);

// Drop server-only secrets from a plan before it is serialised.
export const withoutSecrets = (plan) => {
  if (!plan || typeof plan !== 'object') return plan;
  const { tester_token: _omit, ...rest } = plan;
  return rest;
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// test_url allow-list: https://slot-N.<public domain> or any *.rl.lan host.
// Returns { url } (null when absent) or { error } for a 400.
export const checkTestUrl = (raw, publicDomain) => {
  if (raw === undefined || raw === null || raw === '') return { url: null };
  if (typeof raw !== 'string') return { error: 'test_url must be a string' };
  const trimmed = raw.trim();
  if (trimmed.length > 500) return { error: 'test_url too long (max 500)' };
  let u;
  try { u = new URL(trimmed); } catch { return { error: 'test_url is not a valid URL' }; }
  if (u.username || u.password) return { error: 'test_url must not carry credentials' };
  const host = u.hostname.toLowerCase();
  const isLan = /^([a-z0-9-]+\.)+rl\.lan$/.test(host) && (u.protocol === 'http:' || u.protocol === 'https:');
  const slotRe = publicDomain ? new RegExp(`^slot-\\d+\\.${escapeRe(publicDomain.toLowerCase())}$`) : null;
  const isSlot = slotRe !== null && u.protocol === 'https:' && slotRe.test(host);
  if (!isLan && !isSlot) {
    return { error: `test_url host must be https://slot-N.${publicDomain || '<RL_PUBLIC_DOMAIN>'} or *.rl.lan` };
  }
  return { url: trimmed };
};

const hostOf = (raw) => {
  try { return new URL(String(raw).trim()).hostname.toLowerCase(); } catch { return null; }
};

// Re-checks every step's test_url against the allow-list (Codex c1): plans
// stored before the create-time check existed may carry any link. A failing
// link is nulled and marked `test_url_blocked: true` so the UI shows a
// "link blocked" note instead. Returns the safe plan plus one
// { step_id, host } per stripped link (for the audit log). Pure.
export const sanitizePlanTestUrls = (plan, publicDomain) => {
  const blocked = [];
  if (!plan || !Array.isArray(plan.steps)) return { plan, blocked };
  const steps = plan.steps.map((s) => {
    if (!s || !checkTestUrl(s.test_url, publicDomain).error) return s;
    blocked.push({ step_id: s.id ?? null, host: hostOf(s.test_url) });
    return { ...s, test_url: null, test_url_blocked: true };
  });
  return { plan: blocked.length ? { ...plan, steps } : plan, blocked };
};
