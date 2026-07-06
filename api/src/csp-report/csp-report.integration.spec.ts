/**
 * ROK-1365 — CSP report endpoint hardening.
 *
 * Boots a minimal app wired exactly like `main.ts` (the CSP-report body parser
 * installed before Nest's default json parser) and proves the AC2 contract:
 * a malformed/truncated report body returns 204, NOT 400.
 *
 * Why this matters: `body-parser` runs `strict:true`, so before ROK-1365 a
 * malformed report body threw a SyntaxError that Nest surfaced as HTTP 400.
 * CSP report endpoints must never 400 — browsers fire-and-forget these and
 * curl-driven probes/scanners send garbage. No DB is needed for this suite, so
 * it builds its own app rather than going through the shared `getTestApp`.
 */
import { type NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as supertest from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { CspReportController } from './csp-report.controller';
import { installCspReportBodyParser } from '../main.helpers';

let app: NestExpressApplication;
let request: TestAgent<supertest.Test>;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [CspReportController],
  }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  // Mirror main.ts: CSP-report parser first, then the default json parser.
  installCspReportBodyParser(app);
  app.useBodyParser('json', { limit: '2mb' });
  await app.init();
  request = supertest.default(app.getHttpServer());
});

afterAll(async () => {
  await app?.close();
});

describe('POST /csp-report (ROK-1365)', () => {
  it('returns 204 for a malformed application/csp-report body (AC2)', async () => {
    const res = await request
      .post('/csp-report')
      .set('Content-Type', 'application/csp-report')
      .send('{"csp-report": {'); // truncated — invalid JSON

    expect(res.status).toBe(204);
  });

  it('returns 204 for a malformed application/reports+json body (AC2)', async () => {
    const res = await request
      .post('/csp-report')
      .set('Content-Type', 'application/reports+json')
      .send('not-json-at-all');

    expect(res.status).toBe(204);
  });

  it('returns 204 for a well-formed CSP violation report', async () => {
    const res = await request
      .post('/csp-report')
      .set('Content-Type', 'application/csp-report')
      .send(
        JSON.stringify({
          'csp-report': {
            'document-uri': 'https://raid.gamernight.net/',
            'blocked-uri': 'eval',
            'violated-directive': 'script-src',
          },
        }),
      );

    expect(res.status).toBe(204);
  });
});
