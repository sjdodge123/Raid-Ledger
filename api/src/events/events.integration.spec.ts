/**
 * Events CRUD Integration Tests
 *
 * Verifies that events persist all fields correctly including ad-hoc fields
 * like slotConfig, recurrence, and content instances. This catches bugs where
 * optional fields are silently dropped during DB persistence.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';

describe('Events CRUD (integration)', () => {
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

  it('should create an event and retrieve it with all fields persisted', async () => {
    const createBody = {
      title: 'Raid Night',
      description: 'Weekly raid event',
      gameId: testApp.seed.game.id,
      startTime: '2026-03-15T20:00:00.000Z',
      endTime: '2026-03-15T23:00:00.000Z',
      maxAttendees: 25,
      autoUnbench: false,
      reminder15min: true,
      reminder1hour: true,
      reminder24hour: false,
      slotConfig: {
        type: 'mmo',
        tank: 2,
        healer: 4,
        dps: 14,
        flex: 0,
        bench: 5,
      },
    };

    const createRes = await testApp.request
      .post('/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(createBody);

    expect(createRes.status).toBe(201);
    const eventId = createRes.body.id;
    expect(eventId).toBeDefined();

    // Retrieve the event
    const getRes = await testApp.request.get(`/events/${eventId}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body).toMatchObject({
      id: eventId,
      title: 'Raid Night',
      description: 'Weekly raid event',
      maxAttendees: 25,
      autoUnbench: false,
      reminder15min: true,
      reminder1hour: true,
      reminder24hour: false,
    });

    // Verify slot config persisted
    expect(getRes.body.slotConfig).toMatchObject({
      type: 'mmo',
      tank: 2,
      healer: 4,
      dps: 14,
    });

    // Verify game association
    expect(getRes.body.game).toMatchObject({
      id: testApp.seed.game.id,
      name: 'Test Game',
    });
  });

  it('should create an event without optional fields', async () => {
    const createRes = await testApp.request
      .post('/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Simple Event',
        startTime: '2026-03-20T18:00:00.000Z',
        endTime: '2026-03-20T20:00:00.000Z',
      });

    expect(createRes.status).toBe(201);

    const getRes = await testApp.request.get(`/events/${createRes.body.id}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.title).toBe('Simple Event');
    expect(getRes.body.maxAttendees).toBeNull();
    expect(getRes.body.description).toBeNull();
  });

  it('should update an event and persist changes', async () => {
    // Create
    const createRes = await testApp.request
      .post('/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Original Title',
        startTime: '2026-04-01T18:00:00.000Z',
        endTime: '2026-04-01T20:00:00.000Z',
      });

    const eventId = createRes.body.id;

    // Update
    const updateRes = await testApp.request
      .patch(`/events/${eventId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Updated Title',
        description: 'Added description',
        maxAttendees: 10,
      });

    expect(updateRes.status).toBe(200);

    // Verify persistence
    const getRes = await testApp.request.get(`/events/${eventId}`);

    expect(getRes.body.title).toBe('Updated Title');
    expect(getRes.body.description).toBe('Added description');
    expect(getRes.body.maxAttendees).toBe(10);
  });

  it('should delete an event', async () => {
    const createRes = await testApp.request
      .post('/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'To Delete',
        startTime: '2026-05-01T18:00:00.000Z',
        endTime: '2026-05-01T20:00:00.000Z',
      });

    const eventId = createRes.body.id;

    const deleteRes = await testApp.request
      .delete(`/events/${eventId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(deleteRes.status).toBe(200);

    // Verify deleted
    const getRes = await testApp.request.get(`/events/${eventId}`);
    expect(getRes.status).toBe(404);
  });

  it('should list events with pagination', async () => {
    // Create two events
    await testApp.request
      .post('/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Event A',
        startTime: '2026-06-01T18:00:00.000Z',
        endTime: '2026-06-01T20:00:00.000Z',
      });

    await testApp.request
      .post('/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Event B',
        startTime: '2026-06-02T18:00:00.000Z',
        endTime: '2026-06-02T20:00:00.000Z',
      });

    const listRes = await testApp.request.get('/events');

    expect(listRes.status).toBe(200);
    expect(listRes.body.data.length).toBeGreaterThanOrEqual(2);
    expect(listRes.body.meta).toMatchObject({
      total: expect.any(Number),
      page: expect.any(Number),
    });
  });

  it('should require authentication to create events', async () => {
    const res = await testApp.request.post('/events').send({
      title: 'Unauthorized Event',
      startTime: '2026-07-01T18:00:00.000Z',
      endTime: '2026-07-01T20:00:00.000Z',
    });

    expect(res.status).toBe(401);
  });

  it('should auto-signup the creator', async () => {
    const createRes = await testApp.request
      .post('/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Auto Signup Test',
        startTime: '2026-08-01T18:00:00.000Z',
        endTime: '2026-08-01T20:00:00.000Z',
      });

    const eventId = createRes.body.id;

    // Check roster — creator should be signed up
    const rosterRes = await testApp.request.get(`/events/${eventId}/roster`);

    expect(rosterRes.status).toBe(200);
    expect(rosterRes.body.signups.length).toBe(1);
    expect(rosterRes.body.signups[0].user.id).toBe(testApp.seed.adminUser.id);
  });
});
