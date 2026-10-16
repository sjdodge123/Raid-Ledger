import type { Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import type {
  Metadata,
  StateStore,
  StateStoreStoreCallback,
  StateStoreVerifyCallback,
} from 'passport-oauth2';
import { signOAuthState, verifyOAuthState } from './discord-auth.helpers';
import {
  assertLinkStateBoundToBrowser,
  bindLinkStateToBrowser,
} from '../../auth/link-state-cookie.helpers';

/**
 * ROK-1808: Discord LOGIN state is bound to the browser that started the
 * login, the same way the account-link state is (ROK-1366). Without it,
 * passport-oauth2 ran with its NullStore and never checked state, so an
 * attacker could send a victim `/auth/discord/callback?code=<attacker code>`
 * and sign the victim's browser into the attacker's account (login CSRF).
 *
 * Every login entry (plain `GET /auth/discord`, invite, silent) mints a
 * random `r`, sets an httpOnly cookie of sha256(r) and signs `r` into the
 * state with the action payload. The callback's passport strategy verifies
 * the signature, the 10-minute age and the cookie BEFORE the code exchange,
 * so a forwarded callback never mints a token, writes an auth code or sets
 * `rl_rt`. A match clears the cookie, so each state is single-use.
 */
export const DISCORD_LOGIN_STATE_PROVIDER = 'discord-login';

/** State actions the login callback accepts (a `link` state never is). */
const LOGIN_ACTIONS: ReadonlySet<unknown> = new Set([
  'login',
  'invite',
  'silent',
]);

export type LoginStateCheck =
  { ok: true; state: Record<string, unknown> } | { ok: false; reason: string };

/** Login entry: bind a fresh `r` to this browser and sign it into the state. */
export function signBrowserBoundLoginState(
  res: Response,
  payload: Record<string, unknown>,
  secret: string,
): string {
  const r = bindLinkStateToBrowser(res, DISCORD_LOGIN_STATE_PROVIDER);
  return signOAuthState({ ...payload, timestamp: Date.now(), r }, secret);
}

/** Login callback: signature, age, action and browser binding, in that order. */
export function verifyBrowserBoundLoginState(
  req: Request,
  res: Response,
  state: unknown,
  { secret, logger }: { secret: string; logger: Logger },
): LoginStateCheck {
  if (typeof state !== 'string' || state.length === 0) {
    return { ok: false, reason: 'missing state' };
  }
  const data = verifyOAuthState(state, secret, logger);
  if (!data) return { ok: false, reason: 'invalid or expired state' };
  if (!LOGIN_ACTIONS.has(data.action)) {
    return { ok: false, reason: 'not a login state' };
  }
  try {
    assertLinkStateBoundToBrowser(
      req,
      res,
      DISCORD_LOGIN_STATE_PROVIDER,
      data.r,
    );
  } catch {
    return { ok: false, reason: 'state not bound to this browser' };
  }
  return { ok: true, state: data };
}

/**
 * passport-oauth2 `store` for the Discord login strategy. `store` serves the
 * plain `GET /auth/discord` authorize redirect; `verify` gates the callback.
 * Express puts the response on `req.res`, which is where the cookie goes.
 */
export class DiscordLoginStateStore implements StateStore {
  constructor(
    private readonly getSecret: () => string,
    private readonly logger: Logger,
  ) {}

  store(req: Request, callback: StateStoreStoreCallback): void;
  store(req: Request, meta: Metadata, callback: StateStoreStoreCallback): void;
  store(
    req: Request,
    metaOrCb: Metadata | StateStoreStoreCallback,
    maybeCb?: StateStoreStoreCallback,
  ): void {
    const cb = typeof metaOrCb === 'function' ? metaOrCb : maybeCb;
    if (!cb) return;
    if (!req.res) {
      cb(new Error('Discord login state: no response to bind'), undefined);
      return;
    }
    const state = signBrowserBoundLoginState(
      req.res,
      { action: 'login' },
      this.getSecret(),
    );
    cb(null, state);
  }

  verify(req: Request, state: string, callback: StateStoreVerifyCallback): void;
  verify(
    req: Request,
    state: string,
    meta: Metadata,
    callback: StateStoreVerifyCallback,
  ): void;
  verify(
    req: Request,
    state: string,
    metaOrCb: Metadata | StateStoreVerifyCallback,
    maybeCb?: StateStoreVerifyCallback,
  ): void {
    const cb = typeof metaOrCb === 'function' ? metaOrCb : maybeCb;
    if (!cb) return;
    if (!req.res) {
      cb(null, false, { message: 'no response to clear the state cookie' });
      return;
    }
    const check = verifyBrowserBoundLoginState(req, req.res, state, {
      secret: this.getSecret(),
      logger: this.logger,
    });
    if (!check.ok) {
      this.logger.warn(`Discord login state rejected: ${check.reason}`);
      cb(null, false, { message: check.reason });
      return;
    }
    cb(null, true, check.state);
  }
}
