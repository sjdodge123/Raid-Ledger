/**
 * ROK-2322 behaviour: through a real Nest/Express app with main.ts's
 * `applyTrustProxy`, the auth cookies' Secure flag follows the scheme the
 * browser used. Prod runs browser → Cloudflare → cloudflared → nginx →
 * Node on 127.0.0.1, and nginx forwards the outer `X-Forwarded-Proto`; a
 * plain-HTTP install sends none. Supertest connects over loopback, which the
 * default TRUST_PROXY covers — so it stands in for the nginx hop.
 */
import { Controller, Get, Req, Res } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Request, Response } from 'express';
import request from 'supertest';
import { applyTrustProxy } from '../main.helpers';
import { setLinkNonceCookie } from './link-nonce-cookie.helpers';
import { bindLinkStateToBrowser } from './link-state-cookie.helpers';
import {
  clearRefreshCookie,
  setRefreshCookie,
} from './refresh/refresh-cookie.helpers';

@Controller('probe')
class CookieProbeController {
  @Get('rt')
  rt(@Res() res: Response) {
    setRefreshCookie(res, 'raw-token', 60_000);
    res.end();
  }

  @Get('rt-clear')
  rtClear(@Res() res: Response) {
    clearRefreshCookie(res);
    res.end();
  }

  @Get('link')
  link(@Req() _req: Request, @Res() res: Response) {
    setLinkNonceCookie(res, 'discord', 'nonce');
    bindLinkStateToBrowser(res, 'steam');
    res.end();
  }
}

/** `trustProxy` undefined = prod default; `false` = dev (no proxy trusted). */
async function buildApp(
  isProduction: boolean,
  trustProxyEnv?: string,
): Promise<NestExpressApplication> {
  const module = await Test.createTestingModule({
    controllers: [CookieProbeController],
  }).compile();
  const app = module.createNestApplication<NestExpressApplication>();
  applyTrustProxy(app, isProduction, trustProxyEnv);
  await app.init();
  return app;
}

async function setCookies(
  app: NestExpressApplication,
  path: string,
  proto?: string,
): Promise<string[]> {
  const req = request(app.getHttpServer()).get(path);
  const res = await (proto ? req.set('X-Forwarded-Proto', proto) : req);
  const raw: unknown = res.headers['set-cookie'];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`${path} set no cookie`);
  }
  return raw.map(String);
}

const isSecure = (c: string) => /;\s*Secure(;|$)/i.test(c);

describe('auth cookies follow the request scheme (ROK-2322)', () => {
  const savedEnv = process.env.NODE_ENV;
  let prod: NestExpressApplication;
  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    prod = await buildApp(true);
  });
  afterAll(async () => {
    process.env.NODE_ENV = savedEnv;
    await prod.close();
  });

  it.each(['/probe/rt', '/probe/rt-clear', '/probe/link'])(
    '%s over plain HTTP in production: no Secure, never SameSite=None',
    async (path) => {
      for (const c of await setCookies(prod, path)) {
        expect({ cookie: c, secure: isSecure(c) }).toEqual({
          cookie: c,
          secure: false,
        });
        expect(c).not.toMatch(/SameSite=None/i);
      }
    },
  );

  it.each(['/probe/rt', '/probe/rt-clear', '/probe/link'])(
    '%s behind a trusted https proxy (X-Forwarded-Proto: https): Secure',
    async (path) => {
      for (const c of await setCookies(prod, path, 'https')) {
        expect({ cookie: c, secure: isSecure(c) }).toEqual({
          cookie: c,
          secure: true,
        });
      }
    },
  );

  it('rl_rt stays SameSite=Strict in production on either scheme', async () => {
    const [http] = await setCookies(prod, '/probe/rt');
    const [https] = await setCookies(prod, '/probe/rt', 'https');
    expect(http).toMatch(/SameSite=Strict/i);
    expect(https).toMatch(/SameSite=Strict/i);
  });

  it('an untrusted hop cannot flip Secure with X-Forwarded-Proto', async () => {
    // Trust only an address the loopback test client is not.
    const app = await buildApp(true, '10.255.255.1');
    try {
      for (const c of await setCookies(app, '/probe/link', 'https')) {
        expect({ cookie: c, secure: isSecure(c) }).toEqual({
          cookie: c,
          secure: false,
        });
      }
    } finally {
      await app.close();
    }
  });
});
