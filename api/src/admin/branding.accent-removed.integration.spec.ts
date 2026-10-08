/**
 * TDB:991 (option A) — the unused community accent colour was dropped.
 * PATCH /admin/branding silently ignores a legacy `communityAccentColor`
 * key (old clients still get 200), stores nothing, and no branding or
 * system response carries the field. A stale row from before the drop is
 * inert and removed by a branding reset.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import { SETTING_KEYS } from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';

describe('TDB:991 — branding accent colour removed', () => {
  let testApp: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    await testApp.app.get(SettingsService).clearBranding();
  });

  it('PATCH ignores a legacy communityAccentColor and stores nothing', async () => {
    const res = await testApp.request
      .patch('/admin/branding')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        communityName: 'Night Raiders',
        communityAccentColor: '#123456',
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      communityName: 'Night Raiders',
      communityLogoUrl: null,
    });
    const settings = testApp.app.get(SettingsService);
    expect(await settings.get(SETTING_KEYS.COMMUNITY_ACCENT_COLOR)).toBeNull();
  });

  it('PATCH accepts a non-hex legacy value instead of 400', async () => {
    const res = await testApp.request
      .patch('/admin/branding')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ communityAccentColor: 'not-a-colour' });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('communityAccentColor');
  });

  it('a stale accent row never reaches /system/branding or /system/status, and reset deletes it', async () => {
    const settings = testApp.app.get(SettingsService);
    await settings.set(SETTING_KEYS.COMMUNITY_ACCENT_COLOR, '#10B981');

    const branding = await testApp.request.get('/system/branding');
    const status = await testApp.request.get('/system/status');
    expect(branding.status).toBe(200);
    expect(branding.body).not.toHaveProperty('communityAccentColor');
    expect(status.status).toBe(200);
    expect(status.body).not.toHaveProperty('communityAccentColor');

    const reset = await testApp.request
      .post('/admin/branding/reset')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(reset.status).toBe(201);
    expect(reset.body).toEqual({ communityName: null, communityLogoUrl: null });
    expect(await settings.get(SETTING_KEYS.COMMUNITY_ACCENT_COLOR)).toBeNull();
  });
});
