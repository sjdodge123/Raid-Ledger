/**
 * Pure helper functions extracted from main.ts for testability.
 * These configure CORS, helmet CSP, and validate environment settings.
 */

type CorsCallback = (err: Error | null, allow?: boolean) => void;
type CorsOriginFn = (origin: string | undefined, cb: CorsCallback) => void;

export interface HelmetOptions {
  crossOriginResourcePolicy: { policy: 'cross-origin' };
  contentSecurityPolicy: {
    directives: Record<string, string[]>;
  };
}

/**
 * Validates CORS configuration for the current environment.
 * - Production requires CORS_ORIGIN to be set
 * - Production blocks wildcard (*)
 * - Production warns (but does not throw) for 'auto' mode
 */
export function validateCorsConfig(
  isProduction: boolean,
  corsOrigin?: string,
  logger: { warn: (msg: string) => void } = console,
): void {
  if (isProduction && !corsOrigin) {
    throw new Error(
      'CORS_ORIGIN environment variable must be set in production',
    );
  }
  if (isProduction && corsOrigin === '*') {
    throw new Error(
      'CORS_ORIGIN=* is not allowed in production. Set a specific origin.',
    );
  }
  if (isProduction && corsOrigin === 'auto') {
    logger.warn(
      'CORS_ORIGIN=auto allows all origins. ' +
        'This is intended for single-origin reverse-proxy deployments only. ' +
        'Set an explicit origin for tighter security.',
    );
  }
}

/**
 * Builds the CORS origin callback function.
 * - Same-origin requests (origin undefined) are always allowed
 * - 'auto' mode allows any origin (proxy-only use case)
 * - Wildcard allows any origin
 * - Specific origin is matched; dev adds localhost variants
 */
export function buildCorsOriginFn(
  isProduction: boolean,
  corsOrigin: string | undefined,
  isAutoOrigin: boolean,
): CorsOriginFn {
  return (origin, callback) => {
    if (!origin) return callback(null, true);
    if (isAutoOrigin) return callback(null, true);
    if (corsOrigin === '*') return callback(null, true);
    const allowed: string[] = [corsOrigin].filter(Boolean) as string[];
    if (!isProduction) {
      allowed.push(
        'http://localhost',
        'http://localhost:80',
        'http://localhost:5173',
        'http://localhost:5174',
      );
    }
    callback(
      allowed.includes(origin) ? null : new Error('Not allowed by CORS'),
      allowed.includes(origin),
    );
  };
}

/**
 * Builds helmet options with an explicit Content-Security-Policy.
 * The API is primarily a JSON service, not an HTML host, so the CSP
 * is restrictive by default to prevent abuse if HTML is ever served.
 */
export function buildHelmetOptions(): HelmetOptions {
  return {
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  };
}
