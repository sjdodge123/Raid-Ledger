/**
 * ROK-1778 — optional privacy contact email. PATCH /admin/branding saves it
 * next to the community name (valid email, '' clears it, junk is a 400) and
 * the public GET /system/status exposes it for the /privacy page.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import { SETTING_KEYS } from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';

describe('ROK-1778 — privacy contact email', () => {
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

  function patch(body: Record<string, unknown>) {
    return testApp.request
      .patch('/admin/branding')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
  }

  it('PATCH saves a valid email and the public status exposes it', async () => {
    const res = await patch({ privacyContactEmail: ' privacy@guild.example ' });
    expect(res.status).toBe(200);
    expect(res.body.privacyContactEmail).toBe('privacy@guild.example');

    const status = await testApp.request.get('/system/status');
    expect(status.status).toBe(200);
    expect(status.body.privacyContactEmail).toBe('privacy@guild.example');
  });

  it('PATCH with an empty string clears it', async () => {
    await patch({ privacyContactEmail: 'privacy@guild.example' });
    const res = await patch({ privacyContactEmail: '' });
    expect(res.status).toBe(200);
    expect(res.body.privacyContactEmail).toBeNull();
    const settings = testApp.app.get(SettingsService);
    expect(await settings.get(SETTING_KEYS.PRIVACY_CONTACT_EMAIL)).toBeNull();
    const status = await testApp.request.get('/system/status');
    expect(status.body).not.toHaveProperty('privacyContactEmail');
  });

  it('PATCH rejects an invalid email with 400 and stores nothing', async () => {
    const res = await patch({ privacyContactEmail: 'not-an-email' });
    expect(res.status).toBe(400);
    const settings = testApp.app.get(SettingsService);
    expect(await settings.get(SETTING_KEYS.PRIVACY_CONTACT_EMAIL)).toBeNull();
  });

  it('PATCH with a valid name and an invalid email saves neither', async () => {
    const settings = testApp.app.get(SettingsService);
    const before = await settings.get(SETTING_KEYS.COMMUNITY_NAME);
    const res = await patch({
      communityName: 'Should Not Save',
      privacyContactEmail: 'nope',
    });
    expect(res.status).toBe(400);
    expect(await settings.get(SETTING_KEYS.COMMUNITY_NAME)).toBe(before);
  });

  it('PATCH with only a community name leaves the email untouched', async () => {
    await patch({ privacyContactEmail: 'privacy@guild.example' });
    const res = await patch({ communityName: 'Night Raiders' });
    expect(res.status).toBe(200);
    expect(res.body.privacyContactEmail).toBe('privacy@guild.example');
  });

  it('a branding reset clears it', async () => {
    await patch({ privacyContactEmail: 'privacy@guild.example' });
    const reset = await testApp.request
      .post('/admin/branding/reset')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(reset.status).toBe(201);
    const settings = testApp.app.get(SettingsService);
    expect(await settings.get(SETTING_KEYS.PRIVACY_CONTACT_EMAIL)).toBeNull();
  });
});
