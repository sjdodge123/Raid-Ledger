/**
 * ROK-1732 — the global CORS policy.
 *
 * `CORS_ORIGIN=auto` means SAME-ORIGIN ONLY: a request is allowed when it has
 * no `Origin`, or when the Origin's hostname equals the request's own `Host`
 * hostname (ports are not compared — nginx strips them). `CORS_AUTO_MODE`
 * picks what happens to a mismatch:
 * - `report` (default this release): nothing is rejected — CORS headers are
 *   exactly what `auto` produced before (Origin reflected) — and the would-be
 *   rejection is logged as `[cors-auto] would-reject` evidence (AC0).
 * - `enforce`: 403 `Origin not allowed`; the route handler never runs.
 * An explicit `CORS_ORIGIN` keeps its allow list (dev adds localhost) and a
 * mismatch is a 403 instead of the old thrown Error → 500 (operator Q4).
 *
 * The decision reads `req.headers.host` only — never `req.hostname` or
 * X-Forwarded-Host, which `trust proxy` (ROK-1665) makes client-controlled —
 * and writes nothing process-wide (ROK-1627 invariant).
 */
import { Logger } from '@nestjs/common';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import type { NextFunction, Request, Response } from 'express';
import {
  createCorsReporter,
  type CorsReporter,
  type CorsReportLogger,
} from './cors-report-log';
import {
  decideAutoOrigin,
  decideExplicitOrigin,
  parseCorsAutoMode,
  type CorsAutoMode,
  type CorsDecision,
} from './cors-auto-decision';

export const CORS_FORBIDDEN_BODY = {
  statusCode: 403,
  message: 'Origin not allowed',
} as const;

export interface CorsEnv {
  corsOrigin?: string;
  autoMode?: string;
  clientUrl?: string;
}

/** The slice of INestApplication this needs (keeps tests adapter-free). */
export interface CorsPolicyApp {
  use(...handlers: unknown[]): unknown;
  enableCors(options: unknown): void;
}

export interface CorsPolicyOptions {
  isProduction: boolean;
  /** Read per request so specs can flip env; prod env is static. */
  getEnv?: () => CorsEnv;
  logger?: CorsReportLogger;
  reporter?: CorsReporter;
}

type CorsDelegateCallback = (err: Error | null, o: CorsOptions) => void;

const readProcessEnv = (): CorsEnv => ({
  corsOrigin: process.env.CORS_ORIGIN,
  autoMode: process.env.CORS_AUTO_MODE,
  clientUrl: process.env.CLIENT_URL,
});

function header(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value.join(',') : value;
}

function reportFacts(req: Request, reason: string, env: CorsEnv) {
  return {
    reason,
    origin: header(req, 'origin'),
    host: header(req, 'host'),
    xfh: header(req, 'x-forwarded-host'),
    sfs: header(req, 'sec-fetch-site'),
    method: req.method,
    path: req.path,
    clientUrl: env.clientUrl,
  };
}

/** Mode parse memoised on the raw string, so an invalid value warns once. */
function modeResolver(
  logger: CorsReportLogger,
): (raw?: string) => CorsAutoMode {
  let cached: { raw?: string; mode: CorsAutoMode } | null = null;
  return (raw) => {
    if (cached?.raw !== raw || !cached) {
      cached = { raw, mode: parseCorsAutoMode(raw, (m) => logger.warn(m)) };
    }
    return cached.mode;
  };
}

interface GateContext {
  isProduction: boolean;
  getEnv: () => CorsEnv;
  resolveMode: (raw?: string) => CorsAutoMode;
  reporter: CorsReporter;
  passed: WeakSet<object>;
}

function decideRequest(req: Request, env: CorsEnv, isProduction: boolean) {
  const origin = header(req, 'origin');
  return env.corsOrigin === 'auto'
    ? decideAutoOrigin({
        origin,
        hostHeader: header(req, 'host'),
        isProduction,
      })
    : decideExplicitOrigin({
        origin,
        corsOrigin: env.corsOrigin,
        isProduction,
      });
}

/** Decide → (auto) log → 403, or mark the request as passed and continue. */
function buildGate(ctx: GateContext) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const env = ctx.getEnv();
    const auto = env.corsOrigin === 'auto';
    const decision = decideRequest(req, env, ctx.isProduction);
    const report = auto && ctx.resolveMode(env.autoMode) === 'report';
    if (!decision.allow && !report) {
      res.status(403).json(CORS_FORBIDDEN_BODY);
      return;
    }
    ctx.passed.add(req);
    if (auto) {
      reportDecision(
        ctx.reporter,
        decision,
        reportFacts(req, decision.reason, env),
      );
    }
    next();
  };
}

/**
 * Wires the policy: a gate middleware (decide → log → 403 or pass) followed
 * by `enableCors` in delegate form, which reflects the Origin only for
 * requests the gate let through (same headers `auto` always produced).
 * Call BEFORE `app.init()`/`listen()` so both run ahead of the router.
 */
export function applyCorsPolicy(
  app: CorsPolicyApp,
  options: CorsPolicyOptions,
): void {
  const getEnv = options.getEnv ?? readProcessEnv;
  const logger = options.logger ?? new Logger('CorsPolicy');
  const reporter = options.reporter ?? createCorsReporter(logger);
  const resolveMode = modeResolver(logger);
  const passed = new WeakSet<object>();
  logBootLine(getEnv(), resolveMode, logger);
  const isProduction = options.isProduction;
  app.use(buildGate({ isProduction, getEnv, resolveMode, reporter, passed }));
  app.enableCors((req: Request, cb: CorsDelegateCallback) =>
    cb(null, {
      origin: passed.has(req),
      credentials: true,
      // ROK-1164: the web reads a log download's server-chosen filename.
      exposedHeaders: ['Content-Disposition'],
    }),
  );
}

function reportDecision(
  reporter: CorsReporter,
  decision: CorsDecision,
  facts: ReturnType<typeof reportFacts>,
): void {
  if (decision.reason === 'same-host') reporter.hostCheck(facts);
  else if (!decision.allow) reporter.wouldReject(facts);
}

function logBootLine(
  env: CorsEnv,
  resolveMode: (raw?: string) => CorsAutoMode,
  logger: CorsReportLogger,
): void {
  if (env.corsOrigin !== 'auto') return;
  const mode = resolveMode(env.autoMode);
  const effect =
    mode === 'report'
      ? 'set CORS_AUTO_MODE=enforce to reject'
      : 'mismatched origins get 403';
  logger.log(
    `[cors-auto] mode=${mode} (CORS_ORIGIN=auto; same-origin check; ${effect})`,
  );
}
