/**
 * Integration tests for the Discovery Categories admin controller (ROK-567).
 * Covers auth (admin-only), validation, list/patch/approve/reject flows, the
 * 409 conflict on re-review, and the 503 regenerate guard.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { SETTING_KEYS } from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';

describe('DiscoveryCategoriesAdminController (ROK-567)', () => {
  let testApp: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  async function insertSuggestion(opts: {
    name: string;
    status?: 'pending' | 'approved' | 'rejected' | 'expired';
    sortOrder?: number;
  }): Promise<string> {
    const [row] = await testApp.db
      .insert(schema.discoveryCategorySuggestions)
      .values({
        name: opts.name,
        description: 'd',
        categoryType: 'trend',
        themeVector: [0, 0, 0, 0, 0, 0, 0],
        status: opts.status ?? 'pending',
        populationStrategy: 'vector',
        sortOrder: opts.sortOrder ?? 1000,
      })
      .returning({ id: schema.discoveryCategorySuggestions.id });
    return row.id;
  }

  it('rejects unauthenticated GET with 401', async () => {
    const res = await testApp.request.get('/admin/discovery-categories');
    expect(res.status).toBe(401);
  });

  it('lists all suggestions when no status filter is provided', async () => {
    await insertSuggestion({ name: 'A', status: 'pending', sortOrder: 100 });
    await insertSuggestion({ name: 'B', status: 'approved', sortOrder: 200 });
    const res = await testApp.request
      .get('/admin/discovery-categories')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(
      (res.body as { suggestions: { name: string }[] }).suggestions.map(
        (s) => s.name,
      ),
    ).toEqual(['A', 'B']);
  });

  it('filters by status query param', async () => {
    await insertSuggestion({ name: 'Pending One', status: 'pending' });
    await insertSuggestion({ name: 'Approved One', status: 'approved' });
    const res = await testApp.request
      .get('/admin/discovery-categories')
      .query({ status: 'approved' })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const names = (
      res.body as { suggestions: { name: string }[] }
    ).suggestions.map((s) => s.name);
    expect(names).toEqual(['Approved One']);
  });

  it('returns 400 on a bogus status filter', async () => {
    const res = await testApp.request
      .get('/admin/discovery-categories')
      .query({ status: 'garbage' })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it('patches name + description', async () => {
    const id = await insertSuggestion({ name: 'Old' });
    const res = await testApp.request
      .patch(`/admin/discovery-categories/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'New Name', description: 'New description text' });
    expect(res.status).toBe(200);
    expect((res.body as { name: string }).name).toBe('New Name');
  });

  it('returns 400 when patch body is empty', async () => {
    const id = await insertSuggestion({ name: 'X' });
    const res = await testApp.request
      .patch(`/admin/discovery-categories/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('approves a pending suggestion, marking reviewer + timestamp', async () => {
    const id = await insertSuggestion({ name: 'Needs Review' });
    const res = await testApp.request
      .post(`/admin/discovery-categories/${id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const body = res.body as { status: string; reviewedAt: string | null };
    expect(body.status).toBe('approved');
    expect(body.reviewedAt).not.toBeNull();
  });

  it('returns 409 when approving an already-reviewed suggestion', async () => {
    const id = await insertSuggestion({
      name: 'Already Approved',
      status: 'approved',
    });
    const res = await testApp.request
      .post(`/admin/discovery-categories/${id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(409);
  });

  it('rejects a pending suggestion, accepting an optional reason', async () => {
    const id = await insertSuggestion({ name: 'To Reject' });
    const res = await testApp.request
      .post(`/admin/discovery-categories/${id}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'off-brand' });
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe('rejected');
  });

  it('returns 503 from regenerate when feature flag is disabled', async () => {
    const settings = testApp.app.get(SettingsService);
    await settings.set(SETTING_KEYS.AI_DYNAMIC_CATEGORIES_ENABLED, 'false');
    const res = await testApp.request
      .post('/admin/discovery-categories/regenerate')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(503);
  });
});
