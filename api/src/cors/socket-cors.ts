/**
 * CORS origin decision for the socket.io namespaces (`/lineups`, `/ad-hoc`).
 *
 * Both gateways share one socket.io server, so they must carry the same
 * policy. It is decided per handshake from the same env the HTTP policy
 * reads (`CORS_ORIGIN`, `CORS_AUTO_MODE` — see `cors-auto-policy.ts`) and
 * reuses its pure decisions; there is no `'*'` fallback.
 *
 * Nest's gateway `cors.origin` callback sees only the Origin, not the Host,
 * so `CORS_ORIGIN=auto` (same-origin only) grants no cross-origin access:
 * a same-origin browser client needs no CORS grant, and dev localhost keeps
 * working outside production. `CORS_AUTO_MODE=report` mirrors the HTTP
 * rollback and allows.
 */
import type { CustomOrigin } from '@nestjs/common/interfaces/external/cors-options.interface';
import {
  decideAutoOrigin,
  decideExplicitOrigin,
  parseCorsAutoMode,
} from './cors-auto-decision';
import { readProcessEnv, type CorsEnv } from './cors-auto-policy';

/** Whether a socket handshake from `origin` gets a CORS grant. */
export function socketOriginAllowed(
  origin: string | undefined,
  env: CorsEnv,
  isProduction: boolean,
): boolean {
  const withOrigin = origin === undefined ? {} : { origin };
  if (env.corsOrigin === 'auto') {
    if (parseCorsAutoMode(env.autoMode) === 'report') return true;
    return decideAutoOrigin({ ...withOrigin, isProduction }).allow;
  }
  const corsOrigin = env.corsOrigin ? { corsOrigin: env.corsOrigin } : {};
  return decideExplicitOrigin({ ...withOrigin, ...corsOrigin, isProduction })
    .allow;
}

/** Gateway `cors.origin`: decided at handshake time from `process.env`. */
export const socketCorsOrigin: CustomOrigin = (requestOrigin, callback) => {
  const isProduction = process.env.NODE_ENV === 'production';
  callback(
    null,
    socketOriginAllowed(requestOrigin, readProcessEnv(), isProduction),
  );
};
