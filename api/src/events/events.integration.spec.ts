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

let testApp: TestApp;
let adminToken: string;

async function setupAll() {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
}

async function resetAfterEach() {
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
}

const fullCreateBody = {
  title: 'Raid Night',
  description: 'Weekly raid event',
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

async function testCreateWithAllFields() {
  const createRes = await testApp.request
    .post('/events')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ ...fullCreateBody, gameId: testApp.seed.game.id });

  expect(createRes.status).toBe(201);
  const eventId = createRes.body.id;
  expect(eventId).toBeDefined();

  const getRes = await testApp.request.get(`/events/${eventId}`);
  expect(getRes.status).toBe(200);
  verifyFullEventFields(getRes.body, eventId);
}

function verifyFullEventFields(body: Record<string, unknown>, eventId: number) {
  expect(body).toMatchObject({
    id: eventId,
    title: 'Raid Night',
    description: 'Weekly raid event',
    maxAttendees: 25,
    autoUnbench: false,
    reminder15min: true,
    reminder1hour: true,
    reminder24hour: false,
  });
  expect(body['slotConfig']).toMatchObject({
    type: 'mmo',
    tank: 2,
    healer: 4,
    dps: 14,
  });
  expect(body['game']).toMatchObject({
    id: testApp.seed.game.id,
    name: 'Test Game',
  });
}

async function testCreateWithoutOptionalFields() {
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
}

async function testUpdatePersistsChanges() {
  const createRes = await testApp.request
    .post('/events')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      title: 'Original Title',
      startTime: '2026-04-01T18:00:00.000Z',
      endTime: '2026-04-01T20:00:00.000Z',
    });

  const eventId = createRes.body.id;
  const updateRes = await testApp.request
    .patch(`/events/${eventId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      title: 'Updated Title',
      description: 'Added description',
      maxAttendees: 10,
    });

  expect(updateRes.status).toBe(200);
  const getRes = await testApp.request.get(`/events/${eventId}`);
  expect(getRes.body.title).toBe('Updated Title');
  expect(getRes.body.description).toBe('Added description');
  expect(getRes.body.maxAttendees).toBe(10);
}

async function testDelete() {
  const createRes = await createSimpleEvent('To Delete', '2026-05-01');
  const eventId = createRes.body.id;

  const deleteRes = await testApp.request
    .delete(`/events/${eventId}`)
    .set('Authorization', `Bearer ${adminToken}`);

  expect(deleteRes.status).toBe(200);
  const getRes = await testApp.request.get(`/events/${eventId}`);
  expect(getRes.status).toBe(404);
}

async function testListWithPagination() {
  await createSimpleEvent('Event A', '2026-06-01');
  await createSimpleEvent('Event B', '2026-06-02');

  const listRes = await testApp.request.get('/events');
  expect(listRes.status).toBe(200);
  expect(listRes.body.data.length).toBeGreaterThanOrEqual(2);
  expect(listRes.body.meta).toMatchObject({
    total: expect.any(Number),
    page: expect.any(Number),
  });
}

function createSimpleEvent(title: string, date: string) {
  return testApp.request
    .post('/events')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      title,
      startTime: `${date}T18:00:00.000Z`,
      endTime: `${date}T20:00:00.000Z`,
    });
}

async function testRequiresAuth() {
  const res = await testApp.request.post('/events').send({
    title: 'Unauthorized Event',
    startTime: '2026-07-01T18:00:00.000Z',
    endTime: '2026-07-01T20:00:00.000Z',
  });
  expect(res.status).toBe(401);
}

async function testAutoSignupCreator() {
  const createRes = await createSimpleEvent('Auto Signup Test', '2026-08-01');
  const eventId = createRes.body.id;

  const rosterRes = await testApp.request.get(`/events/${eventId}/roster`);
  expect(rosterRes.status).toBe(200);
  expect(rosterRes.body.signups.length).toBe(1);
  expect(rosterRes.body.signups[0].user.id).toBe(testApp.seed.adminUser.id);
}

beforeAll(() => setupAll());
afterEach(() => resetAfterEach());

describe('Events CRUD — create', () => {
  it('should create with all fields persisted', () =>
    testCreateWithAllFields());
  it('should create without optional fields', () =>
    testCreateWithoutOptionalFields());
});

describe('Events CRUD — update', () => {
  it('should update and persist changes', () => testUpdatePersistsChanges());
});

describe('Events CRUD — delete', () => {
  it('should delete an event', () => testDelete());
});

describe('Events CRUD — list and auth', () => {
  it('should list events with pagination', () => testListWithPagination());
  it('should require authentication to create events', () =>
    testRequiresAuth());
  it('should auto-signup the creator', () => testAutoSignupCreator());
});

// ============================================================
// ROK-1046: GET /events/:id/detail — composite endpoint
// These tests must FAIL before Phase B (route does not exist yet).
// ============================================================

async function createDetailFixtureEvent(): Promise<number> {
  const res = await testApp.request
    .post('/events')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      title: 'Detail Endpoint Event',
      description: 'Fixture for detail composite',
      gameId: testApp.seed.game.id,
      startTime: '2026-09-01T18:00:00.000Z',
      endTime: '2026-09-01T20:00:00.000Z',
      maxAttendees: 10,
    });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

async function testDetailPublicAccessShape() {
  const eventId = await createDetailFixtureEvent();

  const res = await testApp.request.get(`/events/${eventId}/detail`);

  expect(res.status).toBe(200);
  // Runtime shape check (the contract schema does not exist yet during Phase A;
  // this asserts the bundled response matches the agreed-upon DTO body).
  expect(res.body).toMatchObject({
    event: expect.objectContaining({
      id: eventId,
      title: 'Detail Endpoint Event',
    }),
    roster: expect.objectContaining({
      eventId,
      signups: expect.any(Array),
      count: expect.any(Number),
    }),
    rosterAssignments: expect.objectContaining({
      eventId,
      pool: expect.any(Array),
      assignments: expect.any(Array),
    }),
    pugs: expect.any(Array),
    voiceChannel: {
      channelId: null,
      channelName: null,
      guildId: null,
    },
  });
}

async function testDetailAuthenticatedConflictsField() {
  const eventId = await createDetailFixtureEvent();

  const res = await testApp.request
    .get(`/events/${eventId}/detail`)
    .set('Authorization', `Bearer ${adminToken}`);

  expect(res.status).toBe(200);
  // findOne path enriches with myConflicts when authenticated (events.controller.ts:122).
  // The detail composite must mirror that enrichment for parity.
  expect(res.body.event).toHaveProperty('myConflicts');
  expect(Array.isArray(res.body.event.myConflicts)).toBe(true);
}

async function testDetailVoiceChannelGuildIdParity() {
  const eventId = await createDetailFixtureEvent();

  const guestRes = await testApp.request.get(`/events/${eventId}/detail`);
  const authRes = await testApp.request
    .get(`/events/${eventId}/detail`)
    .set('Authorization', `Bearer ${adminToken}`);

  expect(guestRes.status).toBe(200);
  expect(authRes.status).toBe(200);

  // No binding configured in test setup → both should return the empty triple.
  // When a binding IS configured, guest sees guildId=null and auth sees a string
  // (parity with events-attendance.controller.ts:174). The legacy and composite
  // must agree on this behavior.
  const legacyGuest = await testApp.request.get(
    `/events/${eventId}/voice-channel`,
  );
  const legacyAuth = await testApp.request
    .get(`/events/${eventId}/voice-channel`)
    .set('Authorization', `Bearer ${adminToken}`);

  expect(guestRes.body.voiceChannel.guildId).toBe(legacyGuest.body.guildId);
  expect(authRes.body.voiceChannel.guildId).toBe(legacyAuth.body.guildId);
  expect(guestRes.body.voiceChannel.channelId).toBe(legacyGuest.body.channelId);
  expect(authRes.body.voiceChannel.channelId).toBe(legacyAuth.body.channelId);
}

async function testDetailHonorsNotificationChannelOverride() {
  const eventId = await createDetailFixtureEvent();
  const overrideChannelId = '999000111222333444';

  // Architect §3: the override branch (event.notificationChannelOverride ?? …)
  // was missing from the original brief. Without it, every event with a custom
  // channel returns null. Set the override directly via DB to bypass /bind.
  const { events } = await import('../drizzle/schema');
  const { eq } = await import('drizzle-orm');
  await testApp.db
    .update(events)
    .set({ notificationChannelOverride: overrideChannelId })
    .where(eq(events.id, eventId));

  const res = await testApp.request
    .get(`/events/${eventId}/detail`)
    .set('Authorization', `Bearer ${adminToken}`);

  expect(res.status).toBe(200);
  // The composite must short-circuit on override (the same way getVoiceChannel
  // does at events-attendance.controller.ts:100-104). Discord lookup may fail
  // (no real bot); per architect §4 the helper swallows that error. Either way,
  // channelId must reflect the override id we set.
  expect(res.body.voiceChannel.channelId).toBe(overrideChannelId);
}

async function fetchLegacySlices(eventId: number) {
  const [eventRes, rosterRes, assignmentsRes, pugsRes, voiceRes] =
    await Promise.all([
      testApp.request
        .get(`/events/${eventId}`)
        .set('Authorization', `Bearer ${adminToken}`),
      testApp.request.get(`/events/${eventId}/roster`),
      testApp.request.get(`/events/${eventId}/roster/assignments`),
      testApp.request.get(`/events/${eventId}/pugs`),
      testApp.request
        .get(`/events/${eventId}/voice-channel`)
        .set('Authorization', `Bearer ${adminToken}`),
    ]);
  return { eventRes, rosterRes, assignmentsRes, pugsRes, voiceRes };
}

async function testDetailShapeParityPerSlice() {
  const eventId = await createDetailFixtureEvent();
  const detailRes = await testApp.request
    .get(`/events/${eventId}/detail`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(detailRes.status).toBe(200);

  const legacy = await fetchLegacySlices(eventId);
  expect(detailRes.body.event).toEqual(legacy.eventRes.body);
  expect(detailRes.body.roster).toEqual(legacy.rosterRes.body);
  expect(detailRes.body.rosterAssignments).toEqual(legacy.assignmentsRes.body);
  // Legacy returns { pugs: [...] }; bundle exposes the array directly per spec.
  expect(detailRes.body.pugs).toEqual(legacy.pugsRes.body.pugs);
  expect(detailRes.body.voiceChannel).toEqual(legacy.voiceRes.body);
}

async function testDetail404OnMissingEvent() {
  const res = await testApp.request.get('/events/999999/detail');
  expect(res.status).toBe(404);
}

describe('GET /events/:id/detail (ROK-1046)', () => {
  it('returns the composite shape for public access', () =>
    testDetailPublicAccessShape());
  it('enriches event.myConflicts when authenticated (parity with findOne)', () =>
    testDetailAuthenticatedConflictsField());
  it('voiceChannel.guildId parity matches legacy /voice-channel', () =>
    testDetailVoiceChannelGuildIdParity());
  it('honors notificationChannelOverride (architect §3)', () =>
    testDetailHonorsNotificationChannelOverride());
  it('shape parity per slice vs legacy endpoints', () =>
    testDetailShapeParityPerSlice());
  it('returns 404 when the event does not exist', () =>
    testDetail404OnMissingEvent());
});
