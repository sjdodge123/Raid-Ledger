/**
 * Re-signup after departure (ROK-1769) — operator rule: "as long as they
 * re-roster they should be able to join the channel again".
 *
 * A departed member who signs up again must (a) emit a signup event so the
 * Discord embed and private-voice overwrites reconcile, and (b) come off the
 * bench departure parked them on when a roster slot is free. A no-op duplicate
 * of an active signup must emit nothing.
 */
import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { SIGNUP_EVENTS } from '../discord-bot/discord-bot.constants';
import { moveToBench } from '../discord-bot/processors/departure-grace.helpers';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { SignupsService } from './signups.service';
import { handleExistingSignup } from '../discord-bot/listeners/signup-signup.handlers';
import { handleTentative } from '../discord-bot/listeners/signup-status.handlers';
import type { SignupInteractionDeps } from '../discord-bot/listeners/signup-interaction.types';
import type { ButtonInteraction } from 'discord.js';
import {
  createMemberAndLogin,
  createFutureEvent,
  getSignupAssignment,
} from './signups.integration.spec-helpers';

let testApp: TestApp;
let adminToken: string;
let emitSpy: jest.SpyInstance;

const SIGNUP_EVENT_NAMES: readonly string[] = Object.values(SIGNUP_EVENTS);

async function setupAll() {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
}

async function resetAfterEach() {
  emitSpy?.mockRestore();
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
}

/** Signup-event emissions recorded since the spy was (re)installed. */
function signupEmits(): Array<{ name: string; payload: unknown }> {
  return emitSpy.mock.calls
    .filter((c: unknown[]) => SIGNUP_EVENT_NAMES.includes(String(c[0])))
    .map((c: unknown[]) => ({ name: String(c[0]), payload: c[1] }));
}

function spyOnEmitter(): void {
  emitSpy = jest.spyOn(testApp.app.get(EventEmitter2), 'emit');
}

async function postSignup(token: string, eventId: number) {
  const res = await testApp.request
    .post(`/events/${eventId}/signup`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  if (res.status !== 201)
    throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: number; status: string; assignedSlot?: string };
}

/** Mirror DepartureGraceProcessor.applyDeparture's DB writes. */
async function depart(eventId: number, signupId: number): Promise<void> {
  await testApp.db
    .update(schema.eventSignups)
    .set({ status: 'departed' })
    .where(eq(schema.eventSignups.id, signupId));
  await moveToBench(testApp.db, signupId, eventId, new Logger('spec'));
}

/** Event with 2 roster slots; the admin creator auto-fills one. */
async function rosteredThenDeparted(username: string) {
  const eventId = await createFutureEvent(testApp, adminToken, {
    maxAttendees: 2,
  });
  const member = await createMemberAndLogin(
    testApp,
    username,
    `${username}@test.local`,
  );
  const signup = await postSignup(member.token, eventId);
  expect((await getSignupAssignment(testApp, signup.id))?.role).toBe('player');
  await depart(eventId, signup.id);
  expect((await getSignupAssignment(testApp, signup.id))?.role).toBe('bench');
  return { eventId, member, signupId: signup.id };
}

async function testReactivationReslotsAndEmits() {
  const { eventId, member, signupId } = await rosteredThenDeparted('rejoiner');
  spyOnEmitter();
  const body = await postSignup(member.token, eventId);
  expect(body.id).toBe(signupId);
  expect(body.status).toBe('signed_up');
  expect((await getSignupAssignment(testApp, signupId))?.role).toBe('player');
  expect(body.assignedSlot).toBe('player');
  expect(signupEmits()).toEqual([
    {
      name: SIGNUP_EVENTS.UPDATED,
      payload: {
        eventId,
        userId: member.userId,
        signupId,
        action: 'signup_reactivated',
      },
    },
  ]);
}

async function testReactivationStaysBenchedWhenFull() {
  const { eventId, member, signupId } = await rosteredThenDeparted('benched');
  const filler = await createMemberAndLogin(
    testApp,
    'filler',
    'filler@test.local',
  );
  const fillerSignup = await postSignup(filler.token, eventId);
  expect(fillerSignup.assignedSlot).toBe('player');
  spyOnEmitter();
  const body = await postSignup(member.token, eventId);
  expect(body.status).toBe('signed_up');
  expect((await getSignupAssignment(testApp, signupId))?.role).toBe('bench');
  expect(body.assignedSlot).toBe('bench');
  expect(signupEmits().map((e) => e.name)).toEqual([SIGNUP_EVENTS.UPDATED]);
}

async function testActiveDuplicateEmitsNothing() {
  const eventId = await createFutureEvent(testApp, adminToken, {
    maxAttendees: 2,
  });
  const member = await createMemberAndLogin(
    testApp,
    'repeat',
    'repeat@test.local',
  );
  const first = await postSignup(member.token, eventId);
  spyOnEmitter();
  const again = await postSignup(member.token, eventId);
  expect(again.id).toBe(first.id);
  expect(again.assignedSlot).toBe('player');
  expect(signupEmits()).toEqual([]);
}

/** The embed-button handlers' deps, wired to the real app (ROK-1769). */
function buttonDeps(): SignupInteractionDeps {
  return {
    db: testApp.db,
    signupsService: testApp.app.get(SignupsService),
    activityLog: testApp.app.get(ActivityLogService),
    updateEmbedSignupCount: jest.fn().mockResolvedValue(undefined),
  } as unknown as SignupInteractionDeps;
}

/** A Discord button click by the member (createMemberAndLogin links `local:<email>`). */
function buttonClick(username: string) {
  const editReply = jest.fn().mockResolvedValue(undefined);
  const interaction = {
    user: { id: `local:${username}@test.local` },
    editReply,
  } as unknown as ButtonInteraction;
  return { interaction, editReply };
}

function replyContent(editReply: jest.Mock): string {
  const arg = editReply.mock.calls.at(-1)?.[0] as { content?: string };
  return arg?.content ?? '';
}

async function testDiscordSignUpButtonReslots() {
  const { eventId, member, signupId } = await rosteredThenDeparted('btnjoin');
  const { interaction, editReply } = buttonClick('btnjoin');
  const existing = await testApp.app
    .get(SignupsService)
    .findByDiscordUser(eventId, 'local:btnjoin@test.local');
  if (!existing) throw new Error('departed signup not found by discord id');
  spyOnEmitter();
  await handleExistingSignup(interaction, eventId, existing, buttonDeps());
  expect((await getSignupAssignment(testApp, signupId))?.role).toBe('player');
  expect(signupEmits()).toContainEqual({
    name: SIGNUP_EVENTS.UPDATED,
    payload: {
      eventId,
      userId: member.userId,
      signupId,
      action: 'signup_reactivated',
    },
  });
  expect(replyContent(editReply)).toContain('changed to **signed up**');
}

async function testDiscordSignUpButtonBenchReply() {
  const { eventId, signupId } = await rosteredThenDeparted('btnfull');
  const filler = await createMemberAndLogin(
    testApp,
    'fill2',
    'fill2@test.local',
  );
  await postSignup(filler.token, eventId);
  const { interaction, editReply } = buttonClick('btnfull');
  const existing = await testApp.app
    .get(SignupsService)
    .findByDiscordUser(eventId, 'local:btnfull@test.local');
  if (!existing) throw new Error('departed signup not found by discord id');
  await handleExistingSignup(interaction, eventId, existing, buttonDeps());
  expect((await getSignupAssignment(testApp, signupId))?.role).toBe('bench');
  expect(replyContent(editReply)).toContain('placed on the **bench**');
}

async function testDiscordTentativeButtonReslots() {
  const { eventId, member, signupId } = await rosteredThenDeparted('btntent');
  const { interaction } = buttonClick('btntent');
  spyOnEmitter();
  await handleTentative(interaction, eventId, buttonDeps());
  expect((await getSignupAssignment(testApp, signupId))?.role).toBe('player');
  const [row] = await testApp.db
    .select({ status: schema.eventSignups.status })
    .from(schema.eventSignups)
    .where(eq(schema.eventSignups.id, signupId));
  expect(row?.status).toBe('tentative');
  expect(signupEmits()).toContainEqual(
    expect.objectContaining({
      payload: expect.objectContaining({
        userId: member.userId,
        action: 'signup_reactivated',
      }),
    }),
  );
}

beforeAll(() => setupAll());
afterEach(() => resetAfterEach());

describe('Re-signup after departure (ROK-1769)', () => {
  it('re-slots a departed member into a free slot and emits SIGNUP_EVENTS.UPDATED', () =>
    testReactivationReslotsAndEmits());
  it('keeps a departed member benched when no slot is free, still emitting', () =>
    testReactivationStaysBenchedWhenFull());
  it('emits no signup event for a duplicate of an active signup', () =>
    testActiveDuplicateEmitsNothing());
});

describe('Re-signup after departure via the Discord embed buttons (ROK-1769)', () => {
  it('Sign Up re-slots a departed linked member and emits signup_reactivated', () =>
    testDiscordSignUpButtonReslots());
  it('Sign Up tells a departed member they landed on the bench when full', () =>
    testDiscordSignUpButtonBenchReply());
  it('Tentative re-slots a departed linked member and emits signup_reactivated', () =>
    testDiscordTentativeButtonReslots());
});
