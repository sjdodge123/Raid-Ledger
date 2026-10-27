/**
 * ROK-1955 L3 — the RFC 8628 poll against a real DB (T-API-1…9, 13).
 * T-API-1's `GET /companion/v1/device` leg added by L4 (device guard).
 */
import { createHash } from 'node:crypto';
import {
  COMPANION_DEVICE_TOKEN_PATTERN,
  CompanionLinkPollSuccessSchema,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import {
  decide,
  deviceCount,
  expireLimiterWindows,
  expireLink,
  linkRow,
  makeUser,
  poll,
  preview,
  startLink,
  withEnv,
} from './testing/companion-link.helpers';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(() => {
  expireLimiterWindows(testApp);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

const errorOf = (body: unknown): unknown => (body as { error?: unknown }).error;

describe('companion device link — poll', () => {
  it('T-API-1 start → approve → poll issues an rlcd_ token once', async () => {
    const user = await makeUser(testApp, 'cd-happy');
    const link = await startLink(testApp);
    expect(link.verificationUriComplete).toContain('/link#code=');
    expect((await decide(testApp, user.token, link.userCode)).status).toBe(200);
    const res = await poll(testApp, link.deviceCode);
    expect(res.status).toBe(200);
    const body = CompanionLinkPollSuccessSchema.parse(res.body);
    expect(body.token).toMatch(COMPANION_DEVICE_TOKEN_PATTERN);
    expect(body.device.name).toBe('Test-PC');
    expect(body.device.state).toBe('active');
    const self = await testApp.request
      .get('/companion/v1/device')
      .set('Authorization', `Bearer ${body.token}`);
    expect(self.status).toBe(200);
    expect(self.body).toEqual({
      deviceId: body.device.id,
      name: 'Test-PC',
      createdAt: body.device.createdAt,
    });
  });

  it('T-API-2 the token and both codes are hashed at rest', async () => {
    const user = await makeUser(testApp, 'cd-hash');
    const link = await startLink(testApp);
    await decide(testApp, user.token, link.userCode);
    const body = CompanionLinkPollSuccessSchema.parse(
      (await poll(testApp, link.deviceCode)).body,
    );
    const devices = await testApp.db.select().from(schema.companionDevices);
    const links = await testApp.db.select().from(schema.companionDeviceLinks);
    const sha = createHash('sha256').update(body.token).digest('hex');
    expect(devices.map((d) => d.tokenHash)).toEqual([sha]);
    const dump = JSON.stringify({ devices, links });
    for (const secret of [
      body.token,
      link.deviceCode,
      link.userCode,
      link.userCode.replace('-', ''),
    ]) {
      expect(dump).not.toContain(secret);
    }
  });

  it('T-API-3 a second poll after success is invalid_grant with no token', async () => {
    const user = await makeUser(testApp, 'cd-once');
    const link = await startLink(testApp);
    await decide(testApp, user.token, link.userCode);
    expect((await poll(testApp, link.deviceCode)).status).toBe(200);
    const again = await poll(testApp, link.deviceCode);
    expect(again.status).toBe(400);
    expect(again.body).toEqual({ error: 'invalid_grant' });
  });

  it('T-API-4 a poll before approval is authorization_pending', async () => {
    const link = await startLink(testApp);
    const res = await poll(testApp, link.deviceCode);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'authorization_pending' });
  });

  it('T-API-5 polling too fast is slow_down and grows the interval', async () => {
    const link = await startLink(testApp);
    expect(errorOf((await poll(testApp, link.deviceCode)).body)).toBe(
      'authorization_pending',
    );
    const fast = await poll(testApp, link.deviceCode);
    expect(fast.status).toBe(400);
    expect(fast.body).toEqual({ error: 'slow_down', interval: 10 });
    expect((await linkRow(testApp, link.deviceCode)).intervalSec).toBe(10);
  });

  it('T-API-6 every poll response is Cache-Control: no-store', async () => {
    const user = await makeUser(testApp, 'cd-cache');
    const link = await startLink(testApp);
    const pending = await poll(testApp, link.deviceCode);
    await decide(testApp, user.token, link.userCode);
    const issued = await poll(testApp, link.deviceCode);
    const unknown = await poll(testApp, 'x'.repeat(43));
    for (const res of [pending, issued, unknown]) {
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });

  it('T-API-7 an expired link polls expired_token; preview/decision 404', async () => {
    const user = await makeUser(testApp, 'cd-expired');
    const link = await startLink(testApp);
    await expireLink(testApp, link.deviceCode);
    const res = await poll(testApp, link.deviceCode);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'expired_token' });
    const seen = await preview(testApp, user.token, link.userCode);
    const decided = await decide(testApp, user.token, link.userCode);
    for (const r of [seen, decided]) {
      expect(r.status).toBe(404);
      expect((r.body as { code?: string }).code).toBe('code_not_found');
    }
  });

  it('T-API-8 unknown/malformed codes are invalid_grant; the 31st failure is 429', async () => {
    await withEnv({ COMPANION_LINK_RATE_POLL_FAILS_PER_IP: '30' }, async () => {
      expect((await poll(testApp, 'short')).body).toEqual({
        error: 'invalid_grant',
      });
      for (let i = 1; i < 30; i += 1) {
        const res = await poll(testApp, 'y'.repeat(43));
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'invalid_grant' });
      }
      const blocked = await poll(testApp, 'y'.repeat(43));
      expect(blocked.status).toBe(429);
      expect(blocked.headers['retry-after']).toBeDefined();
    });
  });

  it('T-API-9 two concurrent polls on an approved link: exactly one token', async () => {
    const user = await makeUser(testApp, 'cd-race');
    const link = await startLink(testApp);
    await decide(testApp, user.token, link.userCode);
    const results = await Promise.all([
      poll(testApp, link.deviceCode),
      poll(testApp, link.deviceCode),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    const loser = results.find((r) => r.status === 400);
    expect(loser?.body).toEqual({ error: 'invalid_grant' });
    expect(await deviceCount(testApp)).toBe(1);
  });

  it('T-API-13 deny → access_denied and no device row', async () => {
    const user = await makeUser(testApp, 'cd-deny');
    const link = await startLink(testApp);
    expect(
      (await decide(testApp, user.token, link.userCode, 'deny')).body,
    ).toEqual({
      status: 'denied',
    });
    const res = await poll(testApp, link.deviceCode);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'access_denied' });
    expect(await deviceCount(testApp)).toBe(0);
  });
});
