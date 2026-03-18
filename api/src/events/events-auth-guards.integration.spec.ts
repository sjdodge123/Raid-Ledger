/**
 * Auth Guard Enforcement Integration Tests (ROK-870)
 *
 * Adversarial tests verifying that the two event data endpoints
 * previously missing authentication now correctly reject unauthenticated
 * and invalidly-authenticated requests:
 *
 *   - GET /events/:id/aggregate-game-time
 *   - GET /events/:id/ad-hoc-roster
 *
 * These are the critical security fix tests for ROK-278 Finding H-4.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import { createFutureEvent } from './signups.integration.spec-helpers';
import * as schema from '../drizzle/schema';

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

// ── Helpers ─────────────────────────────────────────────────

/** Create a minimal ad-hoc event directly in DB. */
async function createAdHocEvent() {
  const now = new Date();
  const [event] = await testApp.db
    .insert(schema.events)
    .values({
      title: 'Guard Test Ad-Hoc Event',
      creatorId: testApp.seed.adminUser.id,
      duration: [now, new Date(now.getTime() + 3_600_000)] as [Date, Date],
      isAdHoc: true,
      adHocStatus: 'live',
    })
    .returning();
  return event;
}

// ── AC-1: GET /events/:id/aggregate-game-time requires auth ──

describe('GET /events/:id/aggregate-game-time — auth guard (AC-1)', () => {
  it('rejects unauthenticated request with 401', async () => {
    const eventId = await createFutureEvent(testApp, adminToken);

    const res = await testApp.request.get(
      `/events/${eventId}/aggregate-game-time`,
    );

    expect(res.status).toBe(401);
  });

  it('rejects request with a malformed token with 401', async () => {
    const eventId = await createFutureEvent(testApp, adminToken);

    const res = await testApp.request
      .get(`/events/${eventId}/aggregate-game-time`)
      .set('Authorization', 'Bearer not-a-valid-jwt');

    expect(res.status).toBe(401);
  });

  it('rejects request with an expired/invalid token signature with 401', async () => {
    const eventId = await createFutureEvent(testApp, adminToken);
    // A valid-format JWT but signed with a different secret
    const badToken =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
      'eyJzdWIiOjEsInJvbGUiOiJhZG1pbiIsImlhdCI6MTcwMDAwMDAwMH0.' +
      'INVALID_SIGNATURE_XXXXXXXXXXXXXXXXXXXXXXXXXXX';

    const res = await testApp.request
      .get(`/events/${eventId}/aggregate-game-time`)
      .set('Authorization', `Bearer ${badToken}`);

    expect(res.status).toBe(401);
  });

  it('allows authenticated request to proceed (returns 200 or 404)', async () => {
    const eventId = await createFutureEvent(testApp, adminToken);

    const res = await testApp.request
      .get(`/events/${eventId}/aggregate-game-time`)
      .set('Authorization', `Bearer ${adminToken}`);

    // Guard passes — either endpoint found or data returned
    expect([200, 404]).toContain(res.status);
  });

  it('returns 200 with valid shape for an existing event', async () => {
    const eventId = await createFutureEvent(testApp, adminToken);

    const res = await testApp.request
      .get(`/events/${eventId}/aggregate-game-time`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      eventId: expect.any(Number),
      totalUsers: expect.any(Number),
      cells: expect.any(Array),
    });
  });
});

// ── AC-2: GET /events/:id/ad-hoc-roster requires auth ────────

describe('GET /events/:id/ad-hoc-roster — auth guard (AC-2)', () => {
  it('rejects unauthenticated request with 401', async () => {
    const event = await createAdHocEvent();

    const res = await testApp.request.get(`/events/${event.id}/ad-hoc-roster`);

    expect(res.status).toBe(401);
  });

  it('rejects request with a malformed token with 401', async () => {
    const event = await createAdHocEvent();

    const res = await testApp.request
      .get(`/events/${event.id}/ad-hoc-roster`)
      .set('Authorization', 'Bearer not-a-valid-jwt');

    expect(res.status).toBe(401);
  });

  it('rejects request with an invalid token signature with 401', async () => {
    const event = await createAdHocEvent();
    const badToken =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
      'eyJzdWIiOjEsInJvbGUiOiJhZG1pbiIsImlhdCI6MTcwMDAwMDAwMH0.' +
      'INVALID_SIGNATURE_XXXXXXXXXXXXXXXXXXXXXXXXXXX';

    const res = await testApp.request
      .get(`/events/${event.id}/ad-hoc-roster`)
      .set('Authorization', `Bearer ${badToken}`);

    expect(res.status).toBe(401);
  });

  it('rejects Bearer-prefixed request with empty token with 401', async () => {
    const event = await createAdHocEvent();

    const res = await testApp.request
      .get(`/events/${event.id}/ad-hoc-roster`)
      .set('Authorization', 'Bearer ');

    expect(res.status).toBe(401);
  });

  it('allows authenticated request to proceed (returns 200)', async () => {
    const event = await createAdHocEvent();

    const res = await testApp.request
      .get(`/events/${event.id}/ad-hoc-roster`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      eventId: event.id,
      participants: expect.any(Array),
      activeCount: expect.any(Number),
    });
  });

  it('returns 200 for a non-ad-hoc event when authenticated', async () => {
    const eventId = await createFutureEvent(testApp, adminToken);

    const res = await testApp.request
      .get(`/events/${eventId}/ad-hoc-roster`)
      .set('Authorization', `Bearer ${adminToken}`);

    // Route is accessible; non-ad-hoc event falls through to voice roster
    expect(res.status).toBe(200);
  });
});

// ── Guard completeness: other guarded endpoints remain protected ──

describe('Audit: other event endpoints retain their guards', () => {
  it('POST /events rejects unauthenticated requests with 401', async () => {
    const res = await testApp.request.post('/events').send({
      title: 'Should fail',
      startTime: '2030-01-01T18:00:00.000Z',
      endTime: '2030-01-01T20:00:00.000Z',
    });

    expect(res.status).toBe(401);
  });

  it('PATCH /events/:id rejects unauthenticated requests with 401', async () => {
    const eventId = await createFutureEvent(testApp, adminToken);

    const res = await testApp.request
      .patch(`/events/${eventId}`)
      .send({ title: 'Updated' });

    expect(res.status).toBe(401);
  });

  it('DELETE /events/:id rejects unauthenticated requests with 401', async () => {
    const eventId = await createFutureEvent(testApp, adminToken);

    const res = await testApp.request.delete(`/events/${eventId}`);

    expect(res.status).toBe(401);
  });

  it('GET /events/:id/variant-context rejects unauthenticated requests with 401', async () => {
    const eventId = await createFutureEvent(testApp, adminToken);

    const res = await testApp.request.get(`/events/${eventId}/variant-context`);

    expect(res.status).toBe(401);
  });

  it('GET /events/:id/attendance rejects unauthenticated requests with 401', async () => {
    const eventId = await createFutureEvent(testApp, adminToken);

    const res = await testApp.request.get(`/events/${eventId}/attendance`);

    expect(res.status).toBe(401);
  });
});

// ── Public endpoints remain accessible without auth ──────────

describe('Public event endpoints remain accessible without auth', () => {
  it('GET /events returns 200 without auth token', async () => {
    const res = await testApp.request.get('/events');

    expect(res.status).toBe(200);
  });

  it('GET /events/:id returns 200 without auth token', async () => {
    const eventId = await createFutureEvent(testApp, adminToken);

    const res = await testApp.request.get(`/events/${eventId}`);

    expect(res.status).toBe(200);
  });
});
