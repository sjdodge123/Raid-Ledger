import type { Request } from 'express';

/**
 * ROK-1808 (review m3): the login state the passport store already verified
 * (signature, age, action, browser binding), handed from the guard to the
 * controller so the callback routes on that one verified copy instead of
 * re-parsing `?state=` itself. passport-oauth2 passes it as `info.state`.
 */
const verifiedLoginStates = new WeakMap<Request, Record<string, unknown>>();

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Guard success path: remember `info.state` for this request. */
export function rememberVerifiedLoginState(req: Request, info: unknown): void {
  if (!isRecord(info) || !isRecord(info.state)) return;
  verifiedLoginStates.set(req, info.state);
}

/** Controller: the verified state, or null when none came through. */
export function verifiedLoginStateOf(
  req: Request,
): Record<string, unknown> | null {
  return verifiedLoginStates.get(req) ?? null;
}
