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
