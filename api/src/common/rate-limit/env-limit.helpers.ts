/**
 * ROK-1955: env-driven limits and the shared 429 body for the in-process
 * per-key limiters (extracted from the ROK-1833 Valheim Link guard).
 */
import { HttpException, HttpStatus } from '@nestjs/common';

/** A positive integer from `process.env[env]`, else `fallback`. */
export function positiveIntFromEnv(env: string, fallback: number): number {
  const raw = process.env[env];
  const n = raw === undefined ? NaN : Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * A per-minute limit from `env`, read per call (integration specs set it).
 * null = unlimited: `THROTTLE_DISABLED=true` lifts the DEFAULT only — an
 * explicit env override still applies. DEMO_MODE never lifts it.
 */
export function envLimit(env: string, fallback: number): number | null {
  const raw = process.env[env];
  const parsed = raw === undefined ? NaN : Number.parseInt(raw, 10);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  if (process.env.THROTTLE_DISABLED === 'true') return null;
  return fallback;
}

/** 429 with the `{ code: 'rate_limited', message }` body. */
export function rateLimited(message: string): HttpException {
  return new HttpException(
    { code: 'rate_limited', message },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}
