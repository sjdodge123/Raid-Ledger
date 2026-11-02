/**
 * CORS origin decision for the socket.io namespaces (`/lineups`, `/ad-hoc`).
 *
 * Both gateways share one socket.io server, so they must carry the same
 * policy. It is decided per handshake from the same env the HTTP policy
 * reads (`CORS_ORIGIN`, `CORS_AUTO_MODE` — see `cors-auto-policy.ts`) and
 * reuses its pure decisions; there is no `'*'` fallback.
 *
 * `CORS_ORIGIN=auto` reads the raw `Host` header exactly like the HTTP gate
 * (`decideRequest` in `cors-auto-policy.ts`), so a same-hostname Origin on
 * another port is allowed on the polling transport too. That needs the
 * request, which Nest's typed `GatewayMetadata.cors` (`CorsOptions`) cannot
 * give, so `SocketCorsIoAdapter` installs `socketCorsDelegate` as socket.io's
 * own typed `ServerOptions.cors`. `CORS_AUTO_MODE=report` mirrors the HTTP
 * rollback and allows.
 */
import type { ServerOptions } from 'socket.io';
import {
  decideAutoOrigin,
  decideExplicitOrigin,
  parseCorsAutoMode,
} from './cors-auto-decision';
import { readProcessEnv, type CorsEnv } from './cors-auto-policy';

/** The delegate form of socket.io's (engine.io's) `cors` option. */
export type SocketCorsDelegate = Extract<
  ServerOptions['cors'],
  (...args: never[]) => void
>;

/**
 * Whether a socket handshake from `origin` gets a CORS grant. `hostHeader` is
 * the raw `Host` request header — never X-Forwarded-Host (see the HTTP gate).
 */
export function socketOriginAllowed(
  origin: string | undefined,
  env: CorsEnv,
  isProduction: boolean,
  hostHeader?: string,
): boolean {
  const withOrigin = origin === undefined ? {} : { origin };
  if (env.corsOrigin === 'auto') {
    if (parseCorsAutoMode(env.autoMode) === 'report') return true;
    const host = hostHeader === undefined ? {} : { hostHeader };
    return decideAutoOrigin({ ...withOrigin, ...host, isProduction }).allow;
  }
  const corsOrigin = env.corsOrigin ? { corsOrigin: env.corsOrigin } : {};
  return decideExplicitOrigin({ ...withOrigin, ...corsOrigin, isProduction })
    .allow;
}

/**
 * socket.io `cors` delegate: decided per request from `process.env` and the
 * request's own Origin + Host headers. A denied Origin gets no ACAO header.
 */
export const socketCorsDelegate: SocketCorsDelegate = (req, callback) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const allowed = socketOriginAllowed(
    req.headers.origin,
    readProcessEnv(),
    isProduction,
    req.headers.host,
  );
  callback(null, { origin: allowed, credentials: true });
};
