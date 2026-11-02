// ROK-1900 — authorization for the "Pending approval" inbox routes (spec D3/D4).
//
//   - inbox key: the operator's own random key. The VM's .env holds only its
//     SHA-256 (RL_APPROVAL_TOKEN_SHA256), so a reader of .env still cannot rule.
//     Presented as `X-Approval-Token`; compared digest-to-digest, constant time.
//   - agent token: the existing ROK-1847 `X-Agent-Token` (plan-auth.js).
//
// Reads (list, item) accept either. Rulings/verdicts accept ONLY the inbox
// key — an agent can never approve its own item. Submit/withdraw are agent-only.
// FAIL CLOSED: with RL_APPROVAL_TOKEN_SHA256 unset or not 64 hex chars, every
// approval route answers 503 approval_token_unconfigured.
import { createHash, timingSafeEqual } from 'node:crypto';
import { agentDenial, agentTokenOk } from './plan-auth.js';

const SHA256_HEX_RE = /^[0-9a-f]{64}$/i;

// Buffer of the expected digest, or null when unset/malformed.
export const parseInboxHash = (raw) => {
  const v = typeof raw === 'string' ? raw.trim() : '';
  return SHA256_HEX_RE.test(v) ? Buffer.from(v, 'hex') : null;
};

export const inboxKeyMatches = (presented, expectedHash) => {
  if (!expectedHash || typeof presented !== 'string' || presented.length === 0) return false;
  return timingSafeEqual(createHash('sha256').update(presented, 'utf8').digest(), expectedHash);
};

const header = (req, name) => {
  const v = req?.headers?.[name];
  return typeof v === 'string' ? v : undefined;
};

const UNCONFIGURED = Object.freeze({ status: 503, error: 'approval_token_unconfigured' });
const NEED_INBOX = Object.freeze({ status: 401, error: 'approval_token_required' });

// need: 'read' | 'inbox' | 'agent'. deny() returns null when allowed, else { status, error }.
export const createApprovalAuth = ({ agentToken = '', inboxHashHex } = {}) => {
  const hash = parseInboxHash(inboxHashHex);
  const isAgent = (req) => agentTokenOk(req, agentToken);
  const isOperator = (req) => inboxKeyMatches(header(req, 'x-approval-token'), hash);
  const deny = (req, need) => {
    if (!hash) return UNCONFIGURED;
    if (need === 'agent') return agentDenial(req, agentToken);
    if (need === 'inbox') return isOperator(req) ? null : NEED_INBOX;
    return isAgent(req) || isOperator(req) ? null : NEED_INBOX;
  };
  // For L3's /approvals-content/ `?k=` (iframes cannot send headers).
  const keyOk = (presented) => inboxKeyMatches(presented, hash);
  return Object.freeze({ configured: hash !== null, deny, isAgent, isOperator, keyOk });
};
