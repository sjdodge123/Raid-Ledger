/**
 * A failed activity-log insert after a signup, status change or cancel has
 * already landed must not turn the request into a 500: the change persists,
 * the audit failure goes to Sentry.
 */
import * as Sentry from '@sentry/nestjs';
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { ActivityLogService } from '../activity-log/activity-log.service';
import {
  createMemberAndLogin,
  createFutureEvent,
} from './signups.integration.spec-helpers';

jest.mock('@sentry/nestjs', () => ({
  ...jest.requireActual<object>('@sentry/nestjs'),
  captureException: jest.fn(),
}));

let testApp: TestApp;
let adminToken: string;

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  jest.restoreAllMocks();
  jest.mocked(Sentry.captureException).mockClear();
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

function failNextAudit(): Error {
  const err = new Error('audit down');
  jest
    .spyOn(testApp.app.get(ActivityLogService), 'log')
    .mockRejectedValueOnce(err);
  return err;
}

async function signupRow(eventId: number, userId: number) {
  const rows = await testApp.db
    .select()
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        eq(schema.eventSignups.userId, userId),
      ),
    );
  return rows[0];
}

async function auditActions(eventId: number): Promise<string[]> {
  const rows = await testApp.db
    .select({ action: schema.activityLog.action })
    .from(schema.activityLog)
    .where(eq(schema.activityLog.entityId, eventId));
  return rows.map((r) => r.action);
}

async function setup(name: string) {
  const member = await createMemberAndLogin(
    testApp,
    name,
    `${name}@test.local`,
  );
  const eventId = await createFutureEvent(testApp, adminToken);
  return { ...member, eventId };
}

function expectCaptured(err: Error, action: string): void {
  expect(Sentry.captureException).toHaveBeenCalledWith(err, {
    tags: { activityLog: action },
  });
}

describe('signup audit writes are best-effort', () => {
  it('signup: 201, row persisted, no signup_added row, Sentry captured', async () => {
    const { userId, token, eventId } = await setup('auditsignup');
    const err = failNextAudit();
    const res = await testApp.request
      .post(`/events/${eventId}/signup`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(201);
    expect(await signupRow(eventId, userId)).toMatchObject({
      status: 'signed_up',
    });
    expect(await auditActions(eventId)).not.toContain('signup_added');
    expectCaptured(err, 'signup_added');
  });

  it('status change: 200 and the tentative status persists', async () => {
    const { userId, token, eventId } = await setup('auditstatus');
    const signup = await testApp.request
      .post(`/events/${eventId}/signup`)
      .set('Authorization', `Bearer ${token}`);
    expect(signup.status).toBe(201);
    const err = failNextAudit();
    const res = await testApp.request
      .patch(`/events/${eventId}/signup/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'tentative' });
    expect(res.status).toBe(200);
    expect(await signupRow(eventId, userId)).toMatchObject({
      status: 'tentative',
    });
    expectCaptured(err, 'signup_status_changed');
  });

  it('cancel: 200 and the row is no longer signed up', async () => {
    const { userId, token, eventId } = await setup('auditcancel');
    const signup = await testApp.request
      .post(`/events/${eventId}/signup`)
      .set('Authorization', `Bearer ${token}`);
    expect(signup.status).toBe(201);
    const err = failNextAudit();
    const res = await testApp.request
      .delete(`/events/${eventId}/signup`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const row = await signupRow(eventId, userId);
    expect(row?.status).not.toBe('signed_up');
    expect(await auditActions(eventId)).not.toContain('signup_cancelled');
    expectCaptured(err, 'signup_cancelled');
  });
});
