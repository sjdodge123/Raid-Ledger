/**
 * ROK-1769 — "how to get back in" DM. A member who loses their place on an
 * event with a PRIVATE ephemeral voice channel gets exactly one DM saying they
 * lost voice access and that signing up again restores it.
 *
 * Trigger sites are proven by the `voice-access.lost` payload they emit (the
 * real listener is held back so it cannot race the assertions); the DM itself
 * is proven by calling the real listener and observing the real
 * `DiscordNotificationService.dispatch` (resolves true = queued for DM).
 */
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { SignupsService } from '../events/signups.service';
import {
  createMemberAndLogin,
  createFutureEvent,
  getSignupAssignment,
} from '../events/signups.integration.spec-helpers';
import { DiscordNotificationService } from './discord-notification.service';
import { NotificationService } from './notification.service';
import { VoiceAccessLostListener } from './voice-access-lost.listener';
import {
  VOICE_ACCESS_LOST_EVENT,
  hadVoiceAccess,
  type VoiceAccessLostPayload,
} from './voice-access-lost.helpers';

let testApp: TestApp;
let adminToken: string;
let seq = 0;
let voiceEmits: VoiceAccessLostPayload[] = [];
let dispatchSpy: jest.SpyInstance;
let emitSpy: jest.SpyInstance;

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

beforeEach(() => {
  voiceEmits = [];
  const emitter = testApp.app.get(EventEmitter2);
  const original = emitter.emit.bind(emitter);
  emitSpy = jest
    .spyOn(emitter, 'emit')
    .mockImplementation((name: unknown, ...args: unknown[]) => {
      if (name !== VOICE_ACCESS_LOST_EVENT)
        return original(name as string, ...args);
      voiceEmits.push(args[0] as VoiceAccessLostPayload);
      return true;
    });
  dispatchSpy = jest.spyOn(
    testApp.app.get(DiscordNotificationService),
    'dispatch',
  );
});

afterEach(async () => {
  emitSpy.mockRestore();
  dispatchSpy.mockRestore();
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

const listener = () => testApp.app.get(VoiceAccessLostListener);
const signups = () => testApp.app.get(SignupsService);

/** A Discord-linked member rostered (player slot) on a private-voice event. */
async function rosteredOnPrivateEvent(privateVoice = true) {
  seq += 1;
  const eventId = await createFutureEvent(testApp, adminToken, {
    maxAttendees: 2,
  });
  await testApp.db
    .update(schema.events)
    .set({ privateVoice, ephemeralVoiceEnabled: true })
    .where(eq(schema.events.id, eventId));
  const member = await createMemberAndLogin(
    testApp,
    `vox${seq}`,
    `vox${seq}@test.local`,
  );
  await testApp.db
    .update(schema.users)
    .set({ discordId: `7700000000000${String(seq).padStart(5, '0')}` })
    .where(eq(schema.users.id, member.userId));
  const res = await testApp.request
    .post(`/events/${eventId}/signup`)
    .set('Authorization', `Bearer ${member.token}`)
    .send({});
  expect(res.status).toBe(201);
  const signupId = (res.body as { id: number }).id;
  expect((await getSignupAssignment(testApp, signupId))?.role).toBe('player');
  return { eventId, userId: member.userId, signupId };
}

function voiceDmCalls(userId: number): unknown[][] {
  return dispatchSpy.mock.calls.filter((c: unknown[]) => {
    const input = c[0] as { userId: number; payload?: { subtype?: string } };
    return (
      input.userId === userId && input.payload?.subtype === 'voice_access_lost'
    );
  });
}

describe('ROK-1769 voice-access DM — triggers', () => {
  it('organizer removal emits voice-access.lost for a rostered member', async () => {
    const m = await rosteredOnPrivateEvent();
    await signups().adminRemoveSignup(
      m.eventId,
      m.signupId,
      testApp.seed.adminUser.id,
      true,
    );
    expect(voiceEmits).toEqual([
      { eventId: m.eventId, userId: m.userId, reason: 'admin_removed' },
    ]);
  });

  it('a roster edit that benches a member emits voice-access.lost', async () => {
    const m = await rosteredOnPrivateEvent();
    await signups().updateRoster(m.eventId, testApp.seed.adminUser.id, true, {
      assignments: [
        {
          userId: m.userId,
          signupId: m.signupId,
          slot: 'bench',
          position: 1,
          isOverride: false,
        },
      ],
    });
    expect(voiceEmits).toEqual([
      { eventId: m.eventId, userId: m.userId, reason: 'benched' },
    ]);
  });

  it('a bench-only or declined member never had access', () => {
    expect(hadVoiceAccess('signed_up', 'bench')).toBe(false);
    expect(hadVoiceAccess('declined', 'player')).toBe(false);
    expect(hadVoiceAccess('tentative', null)).toBe(true);
  });
});

describe('ROK-1769 voice-access DM — listener', () => {
  it('sends exactly one Sign Up DM per removal, deduping a repeat trigger', async () => {
    const m = await rosteredOnPrivateEvent();
    const p = {
      eventId: m.eventId,
      userId: m.userId,
      reason: 'departed' as const,
    };
    expect(await listener().handle(p)).toBe(true);
    expect(await listener().handle(p)).toBe(false);
    const calls = voiceDmCalls(m.userId);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toEqual(
      expect.objectContaining({
        type: 'slot_vacated',
        title: 'Voice Channel Access Removed',
        payload: { eventId: m.eventId, subtype: 'voice_access_lost' },
      }),
    );
    await expect(dispatchSpy.mock.results[0]?.value).resolves.toBe(true);
  });
});

describe('ROK-1769 voice-access DM — listener skips', () => {
  it('sends nothing when the event voice is not private', async () => {
    const m = await rosteredOnPrivateEvent(false);
    const p = {
      eventId: m.eventId,
      userId: m.userId,
      reason: 'benched' as const,
    };
    expect(await listener().handle(p)).toBe(false);
    expect(voiceDmCalls(m.userId)).toHaveLength(0);
  });

  it('sends nothing when the event is cancelled', async () => {
    const m = await rosteredOnPrivateEvent();
    await testApp.db
      .update(schema.events)
      .set({ cancelledAt: new Date() })
      .where(eq(schema.events.id, m.eventId));
    const p = {
      eventId: m.eventId,
      userId: m.userId,
      reason: 'admin_removed' as const,
    };
    expect(await listener().handle(p)).toBe(false);
    expect(voiceDmCalls(m.userId)).toHaveLength(0);
  });

  it('sends nothing when the event has ended or ends within 10 minutes', async () => {
    const m = await rosteredOnPrivateEvent();
    const start = new Date(Date.now() - 60 * 60 * 1000);
    const end = new Date(Date.now() + 5 * 60 * 1000);
    await testApp.db
      .update(schema.events)
      .set({ duration: [start, end] })
      .where(eq(schema.events.id, m.eventId));
    const p = {
      eventId: m.eventId,
      userId: m.userId,
      reason: 'departed' as const,
    };
    expect(await listener().handle(p)).toBe(false);
    expect(voiceDmCalls(m.userId)).toHaveLength(0);
  });

  it('sends nothing to a deactivated user', async () => {
    const m = await rosteredOnPrivateEvent();
    await testApp.db
      .update(schema.users)
      .set({ deactivatedAt: new Date() })
      .where(eq(schema.users.id, m.userId));
    const p = {
      eventId: m.eventId,
      userId: m.userId,
      reason: 'departed' as const,
    };
    expect(await listener().handle(p)).toBe(false);
    expect(voiceDmCalls(m.userId)).toHaveLength(0);
  });

  it('sends no DM when the member turned off Discord DMs for this type', async () => {
    const m = await rosteredOnPrivateEvent();
    await testApp.app.get(NotificationService).updatePreferences(m.userId, {
      channelPrefs: { slot_vacated: { discord: false } },
    });
    const p = {
      eventId: m.eventId,
      userId: m.userId,
      reason: 'departed' as const,
    };
    await listener().handle(p);
    expect(voiceDmCalls(m.userId)).toHaveLength(1);
    await expect(dispatchSpy.mock.results[0]?.value).resolves.toBe(false);
  });
});
