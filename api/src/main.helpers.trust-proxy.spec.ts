/**
 * ROK-1665: prod trusted a fixed hop count of 1, so behind nginx + the Docker
 * bridge every request resolved `req.ip` to 172.17.0.1 and the whole site
 * shared ONE throttler bucket per handler. These specs pin the subnet-based
 * default and the TRUST_PROXY override, end to end through the real throttler.
 */
import { Controller, Get, Req } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as supertest from 'supertest';
import {
  applyTrustProxy,
  DEFAULT_TRUST_PROXY,
  resolveTrustProxy,
} from './main.helpers';
import { RateLimitModule } from './throttler/throttler.module';
import { ThrottlerExceptionFilter } from './throttler/throttler-exception.filter';

const CLIENT_A = '203.0.113.7';
const CLIENT_B = '198.51.100.9';
const BRIDGE = '172.17.0.1';

@Controller('probe')
class ProbeController {
  @SkipThrottle()
  @Get('ip')
  ip(@Req() req: Request) {
    return { ip: req.ip, socket: req.socket.remoteAddress };
  }

  // A direct @Throttle (not @RateLimit) so THROTTLE_DISABLED cannot lift it.
  @Throttle({ default: { limit: 1, ttl: 60_000 } })
  @Get('limited')
  limited() {
    return { ok: true };
  }
}

async function buildApp(
  trustProxyEnv: string | undefined,
): Promise<NestExpressApplication> {
  const module = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), RateLimitModule],
    controllers: [ProbeController],
  }).compile();
  const app = module.createNestApplication<NestExpressApplication>();
  applyTrustProxy(app, true, trustProxyEnv);
  app.useGlobalFilters(new ThrottlerExceptionFilter());
  await app.init();
  return app;
}

function get(app: NestExpressApplication, path: string, xff: string) {
  return supertest
    .default(app.getHttpServer())
    .get(path)
    .set('X-Forwarded-For', xff);
}

async function ipFor(app: NestExpressApplication, xff: string) {
  const res = await get(app, '/probe/ip', xff);
  expect(res.status).toBe(200);
  return (res.body as { ip: string }).ip;
}

describe('resolveTrustProxy (ROK-1665)', () => {
  it('defaults to the private-subnet names when TRUST_PROXY is unset', () => {
    expect(DEFAULT_TRUST_PROXY).toBe('loopback, linklocal, uniquelocal');
    expect(resolveTrustProxy(undefined)).toBe(DEFAULT_TRUST_PROXY);
  });

  it('treats a blank TRUST_PROXY as unset', () => {
    expect(resolveTrustProxy('')).toBe(DEFAULT_TRUST_PROXY);
    expect(resolveTrustProxy('   ')).toBe(DEFAULT_TRUST_PROXY);
  });

  it('parses the number form as a hop count', () => {
    expect(resolveTrustProxy('2')).toBe(2);
    expect(resolveTrustProxy(' 3 ')).toBe(3);
  });

  it('passes the CIDR-list form through in Express syntax', () => {
    const list = '10.0.0.0/8, 192.168.0.0/16';
    expect(resolveTrustProxy(list)).toBe(list);
    expect(resolveTrustProxy('loopback')).toBe('loopback');
  });

  // Express compiles a STRING 'true'/'false' as an IP and throws at boot.
  it('maps true/false (any case) to the Express booleans', () => {
    expect(resolveTrustProxy('true')).toBe(true);
    expect(resolveTrustProxy(' TRUE ')).toBe(true);
    expect(resolveTrustProxy('false')).toBe(false);
    expect(resolveTrustProxy('False')).toBe(false);
  });
});

describe('applyTrustProxy on a real Express app (ROK-1665)', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({}).compile();
    app = module.createNestApplication<NestExpressApplication>();
  });
  afterAll(() => app.close());

  it.each(['true', 'false', 'TRUE'])('boots with TRUST_PROXY=%s', (raw) => {
    expect(() => applyTrustProxy(app, true, raw)).not.toThrow();
  });

  it('names TRUST_PROXY when the value is not valid Express syntax', () => {
    expect(() => applyTrustProxy(app, true, 'loopbak')).toThrow(
      'Invalid TRUST_PROXY "loopbak": invalid IP address: loopbak',
    );
  });
});

describe('applyTrustProxy (ROK-1665)', () => {
  it('does nothing outside production', () => {
    const set = jest.fn();
    applyTrustProxy({ set } as unknown as NestExpressApplication, false, '2');
    expect(set).not.toHaveBeenCalled();
  });

  it('sets the resolved value in production', () => {
    const set = jest.fn();
    const app = { set } as unknown as NestExpressApplication;
    applyTrustProxy(app, true, undefined);
    expect(set).toHaveBeenCalledWith('trust proxy', DEFAULT_TRUST_PROXY);
    applyTrustProxy(app, true, '2');
    expect(set).toHaveBeenLastCalledWith('trust proxy', 2);
  });
});

describe('req.ip with the default trust setting (ROK-1665)', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await buildApp(undefined);
  });
  afterAll(() => app.close());

  it('AC1: resolves the client left of the Docker bridge hop', async () => {
    expect(await ipFor(app, `${CLIENT_A}, ${BRIDGE}`)).toBe(CLIENT_A);
  });

  it('AC3: ignores a spoofed address left of the real client', async () => {
    expect(await ipFor(app, `1.2.3.4, ${CLIENT_A}, ${BRIDGE}`)).toBe(CLIENT_A);
  });

  it('skips an IPv4-mapped IPv6 bridge hop', async () => {
    expect(await ipFor(app, `${CLIENT_A}, ::ffff:${BRIDGE}`)).toBe(CLIENT_A);
  });
});

describe('throttler buckets with the default trust setting (ROK-1665)', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await buildApp(undefined);
  });
  afterAll(() => app.close());

  it('AC2: keeps a separate bucket per client', async () => {
    const first = await get(app, '/probe/limited', `${CLIENT_A}, ${BRIDGE}`);
    expect(first.status).toBe(200);
    const other = await get(app, '/probe/limited', `${CLIENT_B}, ${BRIDGE}`);
    expect(`client B -> ${other.status}`).toBe('client B -> 200');
    const again = await get(app, '/probe/limited', `${CLIENT_A}, ${BRIDGE}`);
    expect(again.status).toBe(429);
  });
});

describe('TRUST_PROXY overrides the default (ROK-1665 AC4)', () => {
  const spoofed = `1.2.3.4, ${CLIENT_A}, ${BRIDGE}`;

  it('number form trusts that many hops', async () => {
    const app = await buildApp('2');
    try {
      expect(await ipFor(app, spoofed)).toBe(CLIENT_A);
    } finally {
      await app.close();
    }
  });

  it('CIDR-list form trusts exactly the listed ranges', async () => {
    const app = await buildApp('127.0.0.0/8, 172.16.0.0/12');
    try {
      expect(await ipFor(app, spoofed)).toBe(CLIENT_A);
    } finally {
      await app.close();
    }
  });

  it('a CIDR list without the bridge range stops at the bridge', async () => {
    const app = await buildApp('127.0.0.0/8');
    try {
      expect(await ipFor(app, spoofed)).toBe(BRIDGE);
    } finally {
      await app.close();
    }
  });

  it('"true" trusts every hop, so the spoofable leftmost address wins', async () => {
    const app = await buildApp('true');
    try {
      expect(await ipFor(app, spoofed)).toBe('1.2.3.4');
    } finally {
      await app.close();
    }
  });

  it('"false" trusts no hop, so req.ip is the socket peer', async () => {
    const app = await buildApp('false');
    try {
      expect(await ipFor(app, spoofed)).toMatch(/127\.0\.0\.1$/);
    } finally {
      await app.close();
    }
  });
});

/**
 * AC5: setting TRUST_PROXY REPLACES the default rather than adding to it, and
 * no single hop count fits every path into the container. Every public-proxy
 * example the docs give is run through the real app for BOTH paths: a NAS
 * reverse proxy in between (the Docker bridge appears in XFF) and a public
 * proxy forwarding straight to the container port (it does not). A hop-count
 * example can only be right for one of them, so documenting one fails here.
 */
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC_PROXY = '198.51.100.50';
const DOCS = ['README.md', '.env.example'];

function publicProxyExamples(doc: string): string[] {
  const text = fs.readFileSync(path.join(REPO_ROOT, doc), 'utf8');
  const found = text.matchAll(/TRUST_PROXY=(\d+|[^`\n]*<proxy-ip>)/g);
  return [...found].map((m) => m[1]);
}

describe('documented TRUST_PROXY examples for a public proxy (ROK-1665 AC5)', () => {
  it.each(DOCS)('%s appends the proxy to the default list', (doc) => {
    const appended = new RegExp(`^${DEFAULT_TRUST_PROXY}, .*<proxy-ip>$`);
    expect(publicProxyExamples(doc)).toContainEqual(
      expect.stringMatching(appended),
    );
  });

  it.each(DOCS)('every %s example resolves the visitor', async (doc) => {
    for (const example of publicProxyExamples(doc)) {
      const app = await buildApp(example.replace('<proxy-ip>', PUBLIC_PROXY));
      try {
        for (const xff of [
          `${CLIENT_A}, ${PUBLIC_PROXY}, ${BRIDGE}`,
          `${CLIENT_A}, ${PUBLIC_PROXY}`,
        ]) {
          const ip = await ipFor(app, `1.2.3.4, ${xff}`);
          expect(`TRUST_PROXY=${example} [${xff}] -> ${ip}`).toBe(
            `TRUST_PROXY=${example} [${xff}] -> ${CLIENT_A}`,
          );
        }
      } finally {
        await app.close();
      }
    }
  });
});
