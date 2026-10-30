/**
 * ROK-1701 — `POST /setup/claim`, `GET /system/status` claim flags, the
 * onboarding Secure Account flip and the DEMO_MODE claim fixture, against a
 * real DB. Cloud is forced per test via `RL_FLAVOUR` (read at call time).
 */
import * as bcrypt from 'bcrypt';
import { eq, isNull, and } from 'drizzle-orm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { REFRESH_COOKIE_NAME } from '../auth/refresh/refresh-cookie.helpers';
import { RefreshTokenService } from '../auth/refresh/refresh-token.service';
import { hashClaimCode, planClaimArm } from './claim-code.helpers';
import { armClaim, readClaimState } from './claim-state.repository';
import { CLAIM_ADMIN_EMAIL } from './claim-admin.repository';
import { ClaimLockService, CLAIM_LOCK_THRESHOLD } from './claim-lock.service';
import { SETUP_CLAIM_EVENTS } from './setup-claim.events';

const CODE = 'ABCD-EFGH-JKLM-NPQR';
const OLD_PASSWORD = 'old-admin-password';
const NEW_PASSWORD = 'a-long-new-password';
const HOUR = 60 * 60 * 1000;

let testApp: TestApp;
const ORIGINAL_FLAVOUR = process.env.RL_FLAVOUR;
const ORIGINAL_DEMO = process.env.DEMO_MODE;

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(() => {
  process.env.RL_FLAVOUR = 'cloud';
});

afterEach(async () => {
  restoreEnv('RL_FLAVOUR', ORIGINAL_FLAVOUR);
  restoreEnv('DEMO_MODE', ORIGINAL_DEMO);
  jest.restoreAllMocks();
  testApp.app.get(ClaimLockService).reset();
  await testApp.app.get(SettingsService).setDemoMode(false);
  testApp.seed = await truncateAllTables(testApp.db);
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

/** The bootstrap account a claim sets (baseline seed is admin@test.local). */
async function seedClaimAdmin() {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${CLAIM_ADMIN_EMAIL}`,
        username: 'claim-admin',
        role: 'admin',
      })
      .returning(),
    'claim admin user',
  );
  await testApp.db.insert(schema.localCredentials).values({
    email: CLAIM_ADMIN_EMAIL,
    passwordHash: await bcrypt.hash(OLD_PASSWORD, 4),
    userId: user.id,
  });
  return user;
}

async function arm(expiresAt = new Date(Date.now() + 72 * HOUR)) {
  await armClaim(testApp.db, { codeHash: hashClaimCode(CODE), expiresAt });
  return expiresAt;
}

function claim(body: object, proto: 'http' | 'https' = 'https') {
  return testApp.request
    .post('/setup/claim')
    .set('x-forwarded-proto', proto)
    .send(body);
}

const valid = () => claim({ code: CODE, newPassword: NEW_PASSWORD });

async function adminHash(): Promise<string> {
  const [row] = nonEmpty(
    await testApp.db
      .select({ hash: schema.localCredentials.passwordHash })
      .from(schema.localCredentials)
      .where(eq(schema.localCredentials.email, CLAIM_ADMIN_EMAIL)),
    'admin@local credential',
  );
  return row.hash;
}

describe('POST /setup/claim — success', () => {
  it('sets the password, consumes the claim, signs in and emits once', async () => {
    const user = await seedClaimAdmin();
    await arm();
    const seen: unknown[] = [];
    const listener = (p: unknown) => seen.push(p);
    const emitter = testApp.app.get(EventEmitter2);
    emitter.on(SETUP_CLAIM_EVENTS.CLAIMED, listener);
    const res = await valid();
    emitter.off(SETUP_CLAIM_EVENTS.CLAIMED, listener);
    expect([res.status, typeof res.body.access_token]).toEqual([200, 'string']);
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    expect(cookies.some((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`))).toBe(
      true,
    );
    expect(await bcrypt.compare(NEW_PASSWORD, await adminHash())).toBe(true);
    const state = await readClaimState(testApp.db);
    expect([state.codeHash, state.claimedAt === null]).toEqual([null, false]);
    expect(seen).toEqual([{ userId: user.id, claimedAt: expect.any(String) }]);
  });

  it('revokes every prior admin@local session and bumps its token version', async () => {
    const user = await seedClaimAdmin();
    await arm();
    await testApp.app.get(RefreshTokenService).issue(user.id, {
      authMethod: 'local',
      userAgent: null,
    });
    expect((await valid()).status).toBe(200);
    const [after] = nonEmpty(
      await testApp.db
        .select({ tv: schema.users.tokenVersion })
        .from(schema.users)
        .where(eq(schema.users.id, user.id)),
      'admin user',
    );
    expect(after.tv).toBeGreaterThan(user.tokenVersion);
    // Only the claim's own new family stays live.
    const live = await testApp.db
      .select({ id: schema.refreshTokens.id })
      .from(schema.refreshTokens)
      .where(
        and(
          eq(schema.refreshTokens.userId, user.id),
          isNull(schema.refreshTokens.revokedAt),
        ),
      );
    expect(live).toHaveLength(1);
  });

  it('two concurrent valid claims: exactly one 200 and one 409', async () => {
    await seedClaimAdmin();
    await arm();
    const statuses = (await Promise.all([valid(), valid()])).map(
      (r) => r.status,
    );
    expect(statuses.sort()).toEqual([200, 409]);
  });
});

describe('POST /setup/claim — refusals', () => {
  it('wrong code → 401 claim_code_invalid, state unchanged', async () => {
    await seedClaimAdmin();
    await arm();
    const res = await claim({ code: 'WRONG-CODE', newPassword: NEW_PASSWORD });
    expect([res.status, res.body.code]).toEqual([401, 'claim_code_invalid']);
    expect((await readClaimState(testApp.db)).codeHash).toBe(
      hashClaimCode(CODE),
    );
    expect(await bcrypt.compare(OLD_PASSWORD, await adminHash())).toBe(true);
  });

  it('replaying a consumed code → 409, even after a re-arm with the same env code', async () => {
    await seedClaimAdmin();
    await arm();
    expect((await valid()).status).toBe(200);
    const replay = await valid();
    expect([replay.status, replay.body.code]).toEqual([
      409,
      'claim_not_available',
    ]);
    const state = await readClaimState(testApp.db);
    const plan = planClaimArm({
      claimedAt: state.claimedAt,
      envCode: CODE,
      now: new Date(),
    });
    expect(plan.kind).toBe('claimed');
    expect((await valid()).status).toBe(409);
  });

  it('not armed → 409 claim_not_available', async () => {
    await seedClaimAdmin();
    const res = await valid();
    expect([res.status, res.body.code]).toEqual([409, 'claim_not_available']);
  });

  it('expired → 410 claim_expired with the restart message', async () => {
    await seedClaimAdmin();
    await arm(new Date(Date.now() - 1000));
    const res = await valid();
    expect([res.status, res.body.code]).toEqual([410, 'claim_expired']);
    expect(res.body.message).toContain('restart the service for a new code');
  });

  it('password shorter than 12 → 400', async () => {
    await seedClaimAdmin();
    await arm();
    const res = await claim({ code: CODE, newPassword: 'short-pw' });
    expect(res.status).toBe(400);
  });

  it('cloud over http → 403 claim_https_required; NAS does not enforce it', async () => {
    await seedClaimAdmin();
    await arm();
    const refused = await claim(
      { code: CODE, newPassword: NEW_PASSWORD },
      'http',
    );
    expect([refused.status, refused.body.code]).toEqual([
      403,
      'claim_https_required',
    ]);
    delete process.env.RL_FLAVOUR;
    const nas = await claim({ code: CODE, newPassword: NEW_PASSWORD }, 'http');
    expect(nas.status).toBe(200);
  });

  it('soft lock: 100 wrong codes → even the right code gets 429; never burned', async () => {
    await seedClaimAdmin();
    await arm();
    for (let i = 0; i < CLAIM_LOCK_THRESHOLD; i++) {
      const wrong = await claim({
        code: `WRONG-${i}`,
        newPassword: NEW_PASSWORD,
      });
      expect(wrong.status).toBe(401);
    }
    const locked = await valid();
    expect([locked.status, locked.body.code]).toEqual([429, 'claim_locked']);
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
    expect(typeof locked.body.retryAt).toBe('string');
    const lapse = Date.now() + 16 * 60 * 1000;
    jest.spyOn(Date, 'now').mockReturnValue(lapse);
    expect((await valid()).status).toBe(200);
  });
});

describe('GET /system/status claim flags', () => {
  it('claimRequired + claimExpiresAt while armed; false and absent after; never the code', async () => {
    await seedClaimAdmin();
    const expiresAt = await arm();
    const before = await testApp.request.get('/system/status');
    expect([before.body.claimRequired, before.body.claimExpiresAt]).toEqual([
      true,
      expiresAt.toISOString(),
    ]);
    expect(JSON.stringify(before.body)).not.toContain(CODE);
    expect(JSON.stringify(before.body)).not.toContain(hashClaimCode(CODE));
    expect((await valid()).status).toBe(200);
    const after = await testApp.request.get('/system/status');
    expect(after.body.claimRequired).toBe(false);
    expect('claimExpiresAt' in after.body).toBe(false);
  });
});

describe('GET /admin/onboarding/status secureAccount (OQ-8b)', () => {
  it('true on a claimed cloud instance, false on NAS', async () => {
    await seedClaimAdmin();
    await arm();
    expect((await valid()).status).toBe(200);
    const token = await loginAsAdmin(testApp.request, testApp.seed);
    const read = () =>
      testApp.request
        .get('/admin/onboarding/status')
        .set('Authorization', `Bearer ${token}`);
    expect((await read()).body.steps.secureAccount).toBe(true);
    delete process.env.RL_FLAVOUR;
    expect((await read()).body.steps.secureAccount).toBe(false);
  });
});

describe('/admin/test/claim fixture (DEMO_MODE, OQ-8d)', () => {
  beforeEach(() => {
    delete process.env.RL_FLAVOUR; // cloud + DEMO_MODE never boots
  });

  async function fixture(path: string, body: object = {}) {
    const token = await loginAsAdmin(testApp.request, testApp.seed);
    return testApp.request
      .post(`/admin/test/claim/${path}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  it('is 403 outside DEMO_MODE', async () => {
    process.env.DEMO_MODE = 'false';
    expect((await fixture('arm', { code: CODE })).status).toBe(403);
    expect((await fixture('reset')).status).toBe(403);
  });

  it('arm → lock → reset restores the original admin@local hash', async () => {
    process.env.DEMO_MODE = 'true';
    await testApp.app.get(SettingsService).setDemoMode(true);
    await seedClaimAdmin();
    const original = await adminHash();
    expect((await fixture('arm', { code: CODE })).status).toBe(200);
    const armed = await testApp.request.get('/system/status');
    expect(armed.body.claimRequired).toBe(true);
    expect((await fixture('lock')).status).toBe(200);
    expect((await valid()).status).toBe(429);
    const reset = await fixture('reset');
    expect([reset.status, reset.body.restored]).toEqual([200, true]);
    expect(await adminHash()).toBe(original);
    const cleared = await testApp.request.get('/system/status');
    expect(cleared.body.claimRequired).toBe(false);
  });

  it('a negative expiresInMinutes arms an already-expired claim (410)', async () => {
    process.env.DEMO_MODE = 'true';
    await testApp.app.get(SettingsService).setDemoMode(true);
    await seedClaimAdmin();
    const res = await fixture('arm', { code: CODE, expiresInMinutes: -1 });
    expect(res.status).toBe(200);
    expect((await valid()).status).toBe(410);
  });
});
