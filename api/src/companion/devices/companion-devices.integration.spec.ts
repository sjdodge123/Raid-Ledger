/**
 * ROK-1955 L4 — the device guard and the Devices API against a real DB
 * (T-API-16…24). The guard's scope is proved both ways: an `rlcd_` token is
 * refused by JWT routes (T-API-20/21), a session JWT is refused by the
 * device route (T-API-22).
 */
import { eq } from 'drizzle-orm';
import { CompanionDeviceListResponseSchema } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { companionDeviceTokens } from './companion-device-token.helpers';
import {
  bearer,
  expireLimiterWindows,
  linkDevice,
  makeUser,
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

const UNAUTHORIZED = { code: 'unauthorized', message: 'Invalid device token' };
const devices = schema.companionDevices;

const self = (token?: string) => {
  const req = testApp.request.get('/companion/v1/device');
  return token === undefined ? req : req.set(bearer(token));
};

async function deviceRow(id: number) {
  const [row] = await testApp.db
    .select()
    .from(devices)
    .where(eq(devices.id, id));
  if (!row) throw new Error(`device ${id} missing`);
  return row;
}

describe('companion device guard + Devices API', () => {
  it('T-API-16 revoke → 204; the token is refused at once; list shows revoked', async () => {
    const user = await makeUser(testApp, 'cd-revoke');
    const dev = await linkDevice(testApp, user.token);
    expect((await self(dev.token)).status).toBe(200);
    const del = await testApp.request
      .delete(`/companion/v1/devices/${dev.deviceId}`)
      .set(bearer(user.token));
    expect(del.status).toBe(204);
    const after = await self(dev.token);
    expect(after.status).toBe(401);
    expect(after.body).toEqual(UNAUTHORIZED);
    const list = await testApp.request
      .get('/companion/v1/devices')
      .set(bearer(user.token));
    const parsed = CompanionDeviceListResponseSchema.parse(list.body);
    expect(parsed.data.map((d) => [d.id, d.state])).toEqual([
      [dev.deviceId, 'revoked'],
    ]);
    const again = await testApp.request
      .delete(`/companion/v1/devices/${dev.deviceId}`)
      .set(bearer(user.token));
    expect(again.status).toBe(404);
    expect(again.body).toMatchObject({ code: 'not_found' });
  });

  it('T-API-16b a device revoked over 30 days ago is no longer listed', async () => {
    const user = await makeUser(testApp, 'cd-old-revoke');
    const dev = await linkDevice(testApp, user.token);
    const old = new Date(Date.now() - 31 * 24 * 3_600_000);
    await testApp.db
      .update(devices)
      .set({ revokedAt: old })
      .where(eq(devices.id, dev.deviceId));
    const list = await testApp.request
      .get('/companion/v1/devices')
      .set(bearer(user.token));
    expect(list.status).toBe(200);
    expect(CompanionDeviceListResponseSchema.parse(list.body).data).toEqual([]);
  });

  it('T-API-17 missing / malformed / rlvl_ / unknown rlcd_ → the identical 401', async () => {
    const unknown = companionDeviceTokens.generate();
    const responses = [
      await self(),
      await testApp.request
        .get('/companion/v1/device')
        .set('Authorization', 'Bearer x'),
      await self(`rlvl_${'a'.repeat(43)}`),
      await self(unknown),
    ];
    expect(responses.map((r) => [r.status, r.body])).toEqual(
      Array(4).fill([401, UNAUTHORIZED]),
    );
  });

  it('T-API-17b the 4th failed token from one IP is 429 when the budget is 3', async () => {
    await withEnv({ COMPANION_DEVICE_RATE_AUTH_PER_MIN: '3' }, async () => {
      const unknown = companionDeviceTokens.generate();
      for (let i = 0; i < 3; i += 1)
        expect((await self(unknown)).status).toBe(401);
      const res = await self(unknown);
      expect(res.status).toBe(429);
      expect(res.body).toMatchObject({ code: 'rate_limited' });
      expect(res.headers['retry-after']).toBeDefined();
    });
  });

  it("T-API-18 a deactivated owner's device token → 401", async () => {
    const user = await makeUser(testApp, 'cd-deact');
    const dev = await linkDevice(testApp, user.token);
    await testApp.db
      .update(schema.users)
      .set({ deactivatedAt: new Date() })
      .where(eq(schema.users.id, user.id));
    const res = await self(dev.token);
    expect(res.status).toBe(401);
    expect(res.body).toEqual(UNAUTHORIZED);
  });

  it.each([
    ['T-API-18b a banned owner', { bannedAt: new Date() }],
    ['T-API-18c an owner in a kick cooldown', { kickedAt: new Date() }],
  ])("%s's device token → the same 401", async (_label, lockout) => {
    const user = await makeUser(testApp, 'cd-lockout');
    const dev = await linkDevice(testApp, user.token);
    await testApp.db
      .update(schema.users)
      .set(lockout)
      .where(eq(schema.users.id, user.id));
    const res = await self(dev.token);
    expect(res.status).toBe(401);
    expect(res.body).toEqual(UNAUTHORIZED);
  });

  it('T-API-19 first call stamps last-used; a second within 60 s does not move it', async () => {
    const user = await makeUser(testApp, 'cd-touch');
    const dev = await linkDevice(testApp, user.token);
    expect((await deviceRow(dev.deviceId)).lastUsedAt).toBeNull();
    await self(dev.token);
    const first = await deviceRow(dev.deviceId);
    expect(first.lastUsedAt).toBeInstanceOf(Date);
    expect(first.lastUsedIpCoarse).not.toBeNull();
    expect(first.lastUsedIpCoarse).not.toMatch(/^(?:::ffff:)?127\.0\.0\.1$/);
    await self(dev.token);
    const second = await deviceRow(dev.deviceId);
    expect(second.lastUsedAt?.getTime()).toBe(first.lastUsedAt?.getTime());
  });

  it('T-API-20 an rlcd_ token cannot call a session route (GET /auth/me, PATCH /users/me)', async () => {
    const user = await makeUser(testApp, 'cd-scope');
    const dev = await linkDevice(testApp, user.token);
    const me = await testApp.request.get('/auth/me').set(bearer(dev.token));
    expect(me.status).toBe(401);
    const patch = await testApp.request
      .patch('/users/me')
      .set(bearer(dev.token))
      .send({ displayName: 'Hijacked' });
    expect(patch.status).toBe(401);
    const [row] = await testApp.db
      .select({ displayName: schema.users.displayName })
      .from(schema.users)
      .where(eq(schema.users.id, user.id));
    expect(row?.displayName).not.toBe('Hijacked');
  });

  it('T-API-21 an optional-JWT route serves an rlcd_ bearer as anonymous', async () => {
    const user = await makeUser(testApp, 'cd-optional');
    const dev = await linkDevice(testApp, user.token);
    const anon = await testApp.request.get('/users');
    const withDevice = await testApp.request
      .get('/users')
      .set(bearer(dev.token));
    const asUser = await testApp.request.get('/users').set(bearer(user.token));
    expect(withDevice.status).toBe(200);
    expect(withDevice.body).toEqual(anon.body);
    expect(asUser.body).not.toEqual(anon.body);
  });

  it('T-API-22 a session JWT cannot call GET /companion/v1/device', async () => {
    const user = await makeUser(testApp, 'cd-reverse');
    await linkDevice(testApp, user.token);
    const res = await self(user.token);
    expect(res.status).toBe(401);
    expect(res.body).toEqual(UNAUTHORIZED);
  });

  it("T-API-23 another user's rename / revoke → 404 and the row is unchanged", async () => {
    const a = await makeUser(testApp, 'cd-owner-a');
    const b = await makeUser(testApp, 'cd-owner-b');
    const dev = await linkDevice(testApp, a.token);
    const path = `/companion/v1/devices/${dev.deviceId}`;
    const rename = await testApp.request
      .patch(path)
      .set(bearer(b.token))
      .send({ name: 'Mine' });
    const revoke = await testApp.request.delete(path).set(bearer(b.token));
    expect([rename.status, rename.body.code]).toEqual([404, 'not_found']);
    expect([revoke.status, revoke.body.code]).toEqual([404, 'not_found']);
    const row = await deviceRow(dev.deviceId);
    expect([row.name, row.revokedAt]).toEqual(['Test-PC', null]);
    const listB = await testApp.request
      .get('/companion/v1/devices')
      .set(bearer(b.token));
    expect(CompanionDeviceListResponseSchema.parse(listB.body).data).toEqual(
      [],
    );
    const own = await testApp.request
      .patch(path)
      .set(bearer(a.token))
      .send({ name: 'Laptop' });
    expect([own.status, own.body.name]).toEqual([200, 'Laptop']);
  });

  it('T-API-24 the list never carries a token hash', async () => {
    const user = await makeUser(testApp, 'cd-nohash');
    const dev = await linkDevice(testApp, user.token);
    const list = await testApp.request
      .get('/companion/v1/devices')
      .set(bearer(user.token));
    expect(list.status).toBe(200);
    const text = JSON.stringify(list.body);
    expect(text).not.toContain('tokenHash');
    expect(text).not.toContain(companionDeviceTokens.hash(dev.token));
    expect(text).not.toContain(dev.token);
  });
});
