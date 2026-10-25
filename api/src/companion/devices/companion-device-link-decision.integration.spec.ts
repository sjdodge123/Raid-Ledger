/**
 * ROK-1955 L3 — start limits, preview and the explicit approve / deny
 * against a real DB (T-API-10, 11, 12, 14, 15 + too_many_pending).
 */
import { CompanionLinkPreviewSchema } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import {
  decide,
  DEVICE,
  expireLimiterWindows,
  expireLink,
  LINK,
  linkRow,
  makeUser,
  poll,
  preview,
  seedDevices,
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

describe('companion device link — start / preview / decision', () => {
  it('preview shows the device and the coarse network, without changing state', async () => {
    const user = await makeUser(testApp, 'cd-preview');
    const link = await startLink(testApp);
    const res = await preview(testApp, user.token, link.userCode.toLowerCase());
    expect(res.status).toBe(200);
    const body = CompanionLinkPreviewSchema.parse(res.body);
    expect(body.device).toEqual(DEVICE);
    expect(body.userCode).toBe(link.userCode);
    expect(body.sameNetworkAsYou).toBe(true);
    expect((await linkRow(testApp, link.deviceCode)).status).toBe('pending');
  });

  it('a fourth pending link from one network is 409 too_many_pending', async () => {
    await withEnv({ COMPANION_LINK_MAX_PENDING_PER_IP: '3' }, async () => {
      for (let i = 0; i < 3; i += 1) await startLink(testApp);
      const res = await testApp.request.post(LINK).send({ device: DEVICE });
      expect(res.status).toBe(409);
      expect((res.body as { code?: string }).code).toBe('too_many_pending');
    });
  });

  it('T-API-10 B cannot preview or decide the link A approved', async () => {
    const a = await makeUser(testApp, 'cd-a');
    const b = await makeUser(testApp, 'cd-b');
    const link = await startLink(testApp);
    expect((await decide(testApp, a.token, link.userCode)).status).toBe(200);
    expect((await preview(testApp, b.token, link.userCode)).status).toBe(404);
    const hijack = await decide(testApp, b.token, link.userCode, 'deny');
    expect(hijack.status).toBe(404);
    const row = await linkRow(testApp, link.deviceCode);
    expect(row.decidedBy).toBe(a.id);
    expect(row.status).toBe('approved');
  });

  it('the same user repeating the same decision is idempotent', async () => {
    const user = await makeUser(testApp, 'cd-idem');
    const link = await startLink(testApp);
    await decide(testApp, user.token, link.userCode);
    const again = await decide(testApp, user.token, link.userCode);
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ status: 'approved' });
  });

  it('T-API-11 ten wrong codes → the eleventh (even a right one) is 429', async () => {
    await withEnv(
      { COMPANION_LINK_RATE_CODE_FAILS_PER_USER: '10' },
      async () => {
        const user = await makeUser(testApp, 'cd-brute');
        const link = await startLink(testApp);
        for (let i = 0; i < 10; i += 1) {
          expect((await preview(testApp, user.token, 'BBBB-BBBB')).status).toBe(
            404,
          );
        }
        const right = await preview(testApp, user.token, link.userCode);
        expect(right.status).toBe(429);
        expect(right.headers['retry-after']).toBeDefined();
        expect((right.body as { code?: string }).code).toBe('rate_limited');
      },
    );
  });

  it('T-API-12 unknown and expired codes are indistinguishable', async () => {
    const user = await makeUser(testApp, 'cd-oracle');
    const link = await startLink(testApp);
    await expireLink(testApp, link.deviceCode);
    const expired = await preview(testApp, user.token, link.userCode);
    const unknown = await preview(testApp, user.token, 'BBBB-BBBB');
    expect(expired.status).toBe(404);
    expect(unknown.status).toBe(expired.status);
    expect(unknown.body).toEqual(expired.body);
  });

  // A deactivated user's access JWT is refused by jwt.strategy with 401 USER_DEACTIVATED (ROK-1753),
  // before NotDeactivatedGuard's 403 path can run — so a deactivated account gets that 401 here.
  it('T-API-14 decision needs a JWT (401) and an active account (401 USER_DEACTIVATED)', async () => {
    const link = await startLink(testApp);
    const anon = await testApp.request
      .post(`${LINK}/decision`)
      .send({ userCode: link.userCode, decision: 'approve' });
    expect(anon.status).toBe(401);
    const gone = await makeUser(testApp, 'cd-deactivated', true);
    const res = await decide(testApp, gone.token, link.userCode);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'USER_DEACTIVATED' });
    expect((await linkRow(testApp, link.deviceCode)).status).toBe('pending');
  });

  it('T-API-15 approve with 10 live devices is 409 device_limit', async () => {
    const user = await makeUser(testApp, 'cd-cap');
    await seedDevices(testApp, user.id, 10);
    const link = await startLink(testApp);
    const res = await decide(testApp, user.token, link.userCode);
    expect(res.status).toBe(409);
    expect((res.body as { code?: string }).code).toBe('device_limit');
    expect((await linkRow(testApp, link.deviceCode)).status).toBe('pending');
  });

  it('the final poll re-checks the cap: 409, link stays approved, no token', async () => {
    const user = await makeUser(testApp, 'cd-cap-poll');
    await seedDevices(testApp, user.id, 9);
    const link = await startLink(testApp);
    expect((await decide(testApp, user.token, link.userCode)).status).toBe(200);
    await seedDevices(testApp, user.id, 1);
    const res = await poll(testApp, link.deviceCode);
    expect(res.status).toBe(409);
    expect(res.body).not.toHaveProperty('token');
    expect((await linkRow(testApp, link.deviceCode)).status).toBe('approved');
  });
});
