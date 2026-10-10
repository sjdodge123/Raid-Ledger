/**
 * ROK-1732 — `applyCorsPolicy` end to end through a real Nest/Express app and
 * the real `cors` middleware (the same `ExpressAdapter.enableCors` main.ts
 * uses), with a probe controller that counts handler executions.
 *
 * The report-mode block is the release's safety proof: for a matrix of
 * Origin/Host pairs it runs the SAME request against the pre-ROK-1732 wiring
 * (a frozen copy of `buildCorsOriginFn`) and the new policy, and requires identical status,
 * body, `Access-Control-*` headers and handler execution.
 */
import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { applyTrustProxy } from '../main.helpers';
import { CSP_REPORT_ROUTE } from '../csp-report/csp-report.constants';
import { applyCorsPolicy, type CorsEnv } from './cors-auto-policy';

const PROD = 'raid.gamernight.net';
const SIBLING = 'https://slot-1.gamernight.net';
let handlerRuns = 0;

@Controller('probe')
class ProbeController {
  @Get()
  get() {
    handlerRuns += 1;
    return { ok: true };
  }

  @Post()
  post() {
    handlerRuns += 1;
    return { ok: true };
  }
}

/** Stands in for the real CSP report controller (same shared route). */
@Controller(CSP_REPORT_ROUTE)
class CspReportProbeController {
  @Post()
  @HttpCode(204)
  handle() {
    handlerRuns += 1;
  }
}

/**
 * Frozen copy of the pre-ROK-1732 `buildCorsOriginFn` (main.helpers.ts @
 * 910fa9f77) — the oracle for "report mode changes nothing". Do not edit.
 */
function legacyOriginFn(
  isProduction: boolean,
  corsOrigin: string | undefined,
  isAutoOrigin: boolean,
) {
  return (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ) => {
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

type Wiring = 'legacy' | 'policy';
interface Probe {
  method?: 'get' | 'post' | 'options';
  origin?: string | undefined;
  host?: string;
  xfh?: string;
  path?: string;
}

const apps: NestExpressApplication[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function makeLogger() {
  return { warn: jest.fn(), log: jest.fn() };
}

async function buildApp(
  wiring: Wiring,
  env: CorsEnv,
  isProduction: boolean,
  logger = makeLogger(),
): Promise<NestExpressApplication> {
  const module = await Test.createTestingModule({
    controllers: [ProbeController, CspReportProbeController],
  }).compile();
  const app = module.createNestApplication<NestExpressApplication>({
    logger: false,
  });
  // ROK-1665: with trust proxy on, req.hostname reads X-Forwarded-Host.
  applyTrustProxy(app, true, 'loopback');
  if (wiring === 'policy') {
    applyCorsPolicy(app, { isProduction, getEnv: () => env, logger });
  } else {
    const auto = env.corsOrigin === 'auto';
    app.enableCors({
      origin: legacyOriginFn(isProduction, env.corsOrigin, auto),
      credentials: true,
      exposedHeaders: ['Content-Disposition'],
    });
  }
  await app.init();
  apps.push(app);
  return app;
}

async function send(app: NestExpressApplication, probe: Probe) {
  const method = probe.method ?? 'post';
  let req = request(app.getHttpServer())[method](probe.path ?? '/probe');
  if (probe.host) req = req.set('Host', probe.host);
  if (probe.origin) req = req.set('Origin', probe.origin);
  if (probe.xfh) req = req.set('X-Forwarded-Host', probe.xfh);
  if (method === 'options') {
    req = req
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');
  }
  const before = handlerRuns;
  const res = await req;
  return { res, ran: handlerRuns > before };
}

/** Everything a browser's CORS check and the caller can observe. */
async function observe(app: NestExpressApplication, probe: Probe) {
  const { res, ran } = await send(app, probe);
  const cors = Object.fromEntries(
    Object.entries(res.headers).filter(([k]) =>
      /^(access-control-|vary$)/.test(k),
    ),
  );
  return { status: res.status, cors, ran };
}

const PROBES: Probe[] = [
  { origin: undefined, host: PROD },
  { origin: `https://${PROD}`, host: PROD },
  { origin: `https://${PROD}`, host: `${PROD}:443` },
  { origin: SIBLING, host: PROD },
  { origin: SIBLING, host: PROD, xfh: 'slot-1.gamernight.net' },
  { origin: 'https://evil.example', host: PROD },
  { origin: 'null', host: PROD },
  { origin: 'http://localhost:5173', host: 'localhost:3000' },
  { origin: 'http://localhost:5173', host: PROD },
  { method: 'get', origin: SIBLING, host: PROD },
  { method: 'options', origin: SIBLING, host: PROD },
  { method: 'options', origin: `https://${PROD}`, host: PROD },
];

describe('report mode changes nothing a client can observe', () => {
  for (const isProduction of [true, false]) {
    for (const autoMode of ['report', 'typo']) {
      it(`auto, prod=${isProduction}, CORS_AUTO_MODE=${autoMode}: identical to legacy`, async () => {
        const env = { corsOrigin: 'auto', autoMode };
        const legacy = await buildApp('legacy', env, isProduction);
        const policy = await buildApp('policy', env, isProduction);
        for (const probe of PROBES) {
          const was = await observe(legacy, probe);
          expect({ probe, now: await observe(policy, probe) }).toEqual({
            probe,
            now: was,
          });
          if (probe.method !== 'options')
            expect({ probe, ran: was.ran }).toEqual({ probe, ran: true });
        }
      });
    }
  }
});

describe('explicit CORS_ORIGIN keeps its allow set; mismatch is 403 not 500 (AC4, Q4)', () => {
  for (const isProduction of [true, false]) {
    it(`prod=${isProduction}`, async () => {
      const env = { corsOrigin: 'https://app.example.com' };
      const legacy = await buildApp('legacy', env, isProduction);
      const policy = await buildApp('policy', env, isProduction);
      const probes = [
        ...PROBES,
        { origin: 'https://app.example.com', host: PROD },
      ];
      for (const probe of probes) {
        const was = await observe(legacy, probe);
        const now = await observe(policy, probe);
        if (was.status === 500) {
          expect({
            probe,
            status: now.status,
            cors: now.cors,
            ran: now.ran,
          }).toEqual({
            probe,
            status: 403,
            cors: {},
            ran: false,
          });
        } else {
          expect({ probe, now }).toEqual({ probe, now: was });
        }
      }
    });
  }

  it('the 403 body names the cause', async () => {
    const app = await buildApp(
      'policy',
      { corsOrigin: 'https://app.example.com' },
      true,
    );
    const { res } = await send(app, {
      origin: 'https://evil.example',
      host: PROD,
    });
    expect(res.body).toEqual({
      statusCode: 403,
      message: 'Origin not allowed',
    });
  });
});

describe('enforce mode', () => {
  const env = { corsOrigin: 'auto', autoMode: 'enforce' };

  it('rejects a sibling-subdomain POST with 403, no CORS headers, handler not run', async () => {
    const app = await buildApp('policy', env, true);
    const { res, ran } = await send(app, { origin: SIBLING, host: PROD });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      statusCode: 403,
      message: 'Origin not allowed',
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    expect(ran).toBe(false);
  });

  it('rejects a sibling preflight with no Access-Control-Allow-Origin', async () => {
    const app = await buildApp('policy', env, true);
    const { res } = await send(app, {
      method: 'options',
      origin: SIBLING,
      host: PROD,
    });
    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('ignores X-Forwarded-Host even with trust proxy on (AC5)', async () => {
    const app = await buildApp('policy', env, true);
    const probe = { origin: SIBLING, host: PROD, xfh: 'slot-1.gamernight.net' };
    const { res, ran } = await send(app, probe);
    expect({ status: res.status, ran }).toEqual({ status: 403, ran: false });
  });

  it('allows a same-host Origin with the credentialed CORS headers', async () => {
    const app = await buildApp('policy', env, true);
    const { res, ran } = await send(app, {
      origin: `https://${PROD}`,
      host: `${PROD}:443`,
    });
    expect(res.status).toBe(201);
    expect(res.headers['access-control-allow-origin']).toBe(`https://${PROD}`);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-expose-headers']).toBe(
      'Content-Disposition',
    );
    expect(ran).toBe(true);
  });

  it('allows a request with no Origin', async () => {
    const app = await buildApp('policy', env, true);
    const { res, ran } = await send(app, { host: PROD });
    expect({ status: res.status, ran }).toEqual({ status: 201, ran: true });
  });

  it('logs no would-reject line (report-only evidence)', async () => {
    const logger = makeLogger();
    const app = await buildApp('policy', env, true, logger);
    await send(app, { origin: SIBLING, host: PROD });
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('report-mode evidence logging', () => {
  const env = {
    corsOrigin: 'auto',
    autoMode: 'report',
    clientUrl: `https://${PROD}`,
  };

  it('logs a would-reject line without the query string', async () => {
    const logger = makeLogger();
    const app = await buildApp('policy', env, true, logger);
    await send(app, {
      origin: SIBLING,
      host: PROD,
      path: '/probe?token=secret-abc',
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      `[cors-auto] would-reject reason=host-mismatch origin=${SIBLING} ` +
        `host=${PROD} xfh=- sfs=- method=POST path=/probe ` +
        'client_url_match=no suppressed=0',
    );
  });

  it('logs one host-check line for a same-host Origin, nothing for no Origin', async () => {
    const logger = makeLogger();
    const app = await buildApp('policy', env, true, logger);
    await send(app, { host: PROD });
    await send(app, { origin: `https://${PROD}`, host: PROD });
    await send(app, { origin: `https://${PROD}`, host: PROD });
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.log.mock.calls.map(([m]) => m)).toEqual([
      '[cors-auto] mode=report (CORS_ORIGIN=auto; same-origin check; set CORS_AUTO_MODE=enforce to reject)',
      `[cors-auto] host-check ok origin=https://${PROD} host=${PROD} xfh=- sfs=-`,
    ]);
  });

  it('logs nothing in explicit-origin mode', async () => {
    const logger = makeLogger();
    const app = await buildApp(
      'policy',
      { corsOrigin: 'https://app.example.com' },
      true,
      logger,
    );
    await send(app, { origin: 'https://evil.example', host: PROD });
    await send(app, { origin: 'https://app.example.com', host: PROD });
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.log).not.toHaveBeenCalled();
  });
});

describe('configuration', () => {
  it('logs the enforce boot line', async () => {
    const logger = makeLogger();
    await buildApp(
      'policy',
      { corsOrigin: 'auto', autoMode: 'enforce' },
      true,
      logger,
    );
    expect(logger.log).toHaveBeenCalledWith(
      '[cors-auto] mode=enforce (set CORS_AUTO_MODE=report to log-only; CORS_ORIGIN=auto same-origin check, mismatched origins get 403)',
    );
  });

  it('warns once for an invalid CORS_AUTO_MODE and keeps allowing (fail open)', async () => {
    const logger = makeLogger();
    const env = { corsOrigin: 'auto', autoMode: 'enforced' };
    const app = await buildApp('policy', env, true, logger);
    await send(app, { origin: `https://${PROD}`, host: PROD });
    const { res } = await send(app, { origin: SIBLING, host: PROD });
    expect(res.status).toBe(201);
    const invalid = logger.warn.mock.calls.filter(([m]) =>
      String(m).includes('CORS_AUTO_MODE='),
    );
    expect(invalid).toHaveLength(1);
  });

  it('re-reads env per request (the integration harness flips it)', async () => {
    const env: CorsEnv = { corsOrigin: 'auto', autoMode: 'report' };
    const app = await buildApp('policy', env, true);
    expect((await send(app, { origin: SIBLING, host: PROD })).res.status).toBe(
      201,
    );
    env.autoMode = 'enforce';
    expect((await send(app, { origin: SIBLING, host: PROD })).res.status).toBe(
      403,
    );
  });

  it('never writes request data to process.env (ROK-1627 invariant)', async () => {
    const before = JSON.stringify(process.env);
    const app = await buildApp(
      'policy',
      { corsOrigin: 'auto', autoMode: 'enforce' },
      true,
    );
    await send(app, {
      origin: SIBLING,
      host: 'attacker.example',
      xfh: 'attacker.example',
    });
    await send(app, {
      origin: 'https://attacker.example',
      host: 'attacker.example',
    });
    expect(JSON.stringify(process.env)).toBe(before);
  });
});

describe('CSP report endpoint is exempt (Origin: null per the Reporting API)', () => {
  const cspProbe = { origin: 'null', host: PROD, path: `/${CSP_REPORT_ROUTE}` };

  for (const autoMode of ['report', 'enforce', undefined]) {
    it(`auto, CORS_AUTO_MODE=${autoMode}: POST is allowed, not logged, not CORS-granted`, async () => {
      const logger = makeLogger();
      const env = { corsOrigin: 'auto', autoMode };
      const app = await buildApp('policy', env, true, logger);
      const { res, ran } = await send(app, cspProbe);
      expect({ status: res.status, ran }).toEqual({ status: 204, ran: true });
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(logger.warn).not.toHaveBeenCalled();
    });
  }

  it('enforce: Origin null to any other path is still rejected', async () => {
    const env = { corsOrigin: 'auto', autoMode: 'enforce' };
    const app = await buildApp('policy', env, true);
    const { res, ran } = await send(app, { origin: 'null', host: PROD });
    expect({ status: res.status, ran }).toEqual({ status: 403, ran: false });
    const sibling = await send(app, { origin: SIBLING, host: PROD });
    expect(sibling.res.status).toBe(403);
  });

  it('enforce: only POST is exempt — a null-origin preflight is still 403', async () => {
    const env = { corsOrigin: 'auto', autoMode: 'enforce' };
    const app = await buildApp('policy', env, true);
    const { res } = await send(app, { ...cspProbe, method: 'options' });
    expect(res.status).toBe(403);
  });

  it('report: a sibling POST to another path is still logged', async () => {
    const logger = makeLogger();
    const env = { corsOrigin: 'auto', autoMode: 'report' };
    const app = await buildApp('policy', env, true, logger);
    await send(app, cspProbe);
    await send(app, { origin: SIBLING, host: PROD });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toContain('path=/probe');
  });

  it('explicit CORS_ORIGIN: the CSP report POST is allowed too', async () => {
    const env = { corsOrigin: 'https://app.example.com' };
    const app = await buildApp('policy', env, true);
    const { res, ran } = await send(app, cspProbe);
    expect({ status: res.status, ran }).toEqual({ status: 204, ran: true });
  });
});

describe('default mode (CORS_AUTO_MODE unset)', () => {
  it('defaults to enforce when CORS_AUTO_MODE is unset (post-AC0 flip)', async () => {
    const logger = makeLogger();
    const app = await buildApp('policy', { corsOrigin: 'auto' }, true, logger);
    const { res, ran } = await send(app, { origin: SIBLING, host: PROD });
    expect({ status: res.status, ran }).toEqual({ status: 403, ran: false });
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining(
        '[cors-auto] mode=enforce (set CORS_AUTO_MODE=report to log-only;',
      ),
    );
  });
});
