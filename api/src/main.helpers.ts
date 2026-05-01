/**
 * Pure helper functions extracted from main.ts for testability.
 * These configure CORS, helmet CSP, and validate environment settings.
 */

import type { LogLevel } from '@nestjs/common';

type CorsCallback = (err: Error | null, allow?: boolean) => void;
type CorsOriginFn = (origin: string | undefined, cb: CorsCallback) => void;

// Descending severity. A threshold like 'log' enables itself plus everything
// to its left (more severe), e.g. error+warn+log. Order matches the original
// inline whitelist that used to live in main.ts so existing log-shipping
// behavior is preserved.
const LOG_LEVELS_DESCENDING: readonly LogLevel[] = [
  'error',
  'warn',
  'log',
  'debug',
  'verbose',
];

export function parseLogLevel(value: string | undefined): LogLevel | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if ((LOG_LEVELS_DESCENDING as readonly string[]).includes(normalized)) {
    return normalized as LogLevel;
  }
  return null;
}

export interface LogLevelEnv {
  DEBUG?: string;
  LOG_LEVEL?: string;
  NODE_ENV?: string;
}

interface ConsoleLike {
  warn: (msg: string) => void;
}

export function getLogLevels(
  env: LogLevelEnv,
  consoleLike: ConsoleLike = console,
): LogLevel[] {
  const rawLogLevel = env.LOG_LEVEL?.trim();
  let threshold: LogLevel;
  if (rawLogLevel) {
    const parsed = parseLogLevel(rawLogLevel);
    if (parsed) {
      threshold = parsed;
    } else {
      consoleLike.warn(
        `Invalid LOG_LEVEL="${rawLogLevel}" — falling back to "log". ` +
          `Valid values: ${LOG_LEVELS_DESCENDING.join(', ')}`,
      );
      threshold = 'log';
    }
  } else if (env.DEBUG === 'true') {
    threshold = 'debug';
  } else if (env.NODE_ENV === 'development') {
    threshold = 'debug';
  } else {
    threshold = 'log';
  }
  const endIdx = LOG_LEVELS_DESCENDING.indexOf(threshold);
  return LOG_LEVELS_DESCENDING.slice(0, endIdx + 1);
}

interface LoggerLike {
  warn: (message: string) => void;
  error: (message: string) => void;
}

export const LOGGER_SELF_TEST_WARN_SENTINEL =
  '[bootstrap-self-test] logger.warn channel active';
export const LOGGER_SELF_TEST_ERROR_SENTINEL =
  '[bootstrap-self-test] logger.error channel active';

export function buildLoggerSelfTest(logger: LoggerLike): () => void {
  return () => {
    logger.warn(LOGGER_SELF_TEST_WARN_SENTINEL);
    logger.error(LOGGER_SELF_TEST_ERROR_SENTINEL);
  };
}

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
