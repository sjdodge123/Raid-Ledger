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
import type { Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
  waitFor,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { SignupsService } from '../events/signups.service';
import {
  createMemberAndLogin,
  createFutureEvent,
  getSignupAssignment,
  createMmoEvent,
  signupWithPrefs,
} from '../events/signups.integration.spec-helpers';
import { formatRoleLabel } from '../events/signups-roster.helpers';
import { DepartureGraceProcessor } from '../discord-bot/processors/departure-grace.processor';
import type { DepartureGraceJobData } from '../discord-bot/queues/departure-grace.queue';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { DiscordNotificationService } from './discord-notification.service';
import { NotificationService } from './notification.service';
import { VoiceAccessLostListener } from './voice-access-lost.listener';
import { SettingsService } from '../settings/settings.service';
import { moveToBench } from '../discord-bot/processors/departure-grace.helpers';
import { Logger } from '@nestjs/common';
import {
  VOICE_ACCESS_LOST_EVENT,
  VOICE_ACCESS_LOST_LINE,
  hadVoiceAccess,
  type VoiceAccessLostPayload,
} from './voice-access-lost.helpers';

let testApp: TestApp;
let adminToken: string;
let seq = 0;
let voiceEmits: VoiceAccessLostPayload[] = [];
let dispatchSpy: jest.SpyInstance;
let emitSpy: jest.SpyInstance;
let connectedSpy: jest.SpyInstance;

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

/** The canonical ephemeral gate's two switches (global master, force). */
async function setEphemeralSwitches(globalOn: boolean, forced: boolean) {
  const settings = testApp.app.get(SettingsService);
  await settings.setEphemeralVoiceEnabled(globalOn);
  await settings.setEphemeralVoiceForced(forced);
}

afterAll(() => setEphemeralSwitches(false, false));

beforeEach(async () => {
  await setEphemeralSwitches(true, false);
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
  // dispatch() skips when the bot is offline; claim it is connected so its
  // resolved value reflects the preference/deactivation gates under test.
  connectedSpy = jest
    .spyOn(testApp.app.get(DiscordBotClientService), 'isConnected')
    .mockReturnValue(true);
  dispatchSpy = jest.spyOn(
    testApp.app.get(DiscordNotificationService),
    'dispatch',
  );
});

afterEach(async () => {
  emitSpy.mockRestore();
  dispatchSpy.mockRestore();
  connectedSpy.mockRestore();
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
  const title = await eventTitle(eventId);
  return { eventId, userId: member.userId, signupId, title };
}

async function eventTitle(eventId: number): Promise<string> {
  const [ev] = await testApp.db
    .select({ title: schema.events.title })
    .from(schema.events)
    .where(eq(schema.events.id, eventId));
  if (!ev) throw new Error(`event ${eventId} not found`);
  return ev.title;
}

async function setPrivateVoice(eventId: number) {
  await testApp.db
    .update(schema.events)
    .set({ privateVoice: true, ephemeralVoiceEnabled: true })
    .where(eq(schema.events.id, eventId));
}

/** Notification rows (= DMs) for a user, by id. */
async function notifRows(userId: number) {
  return testApp.db
    .select({
      id: schema.notifications.id,
      type: schema.notifications.type,
      title: schema.notifications.title,
      message: schema.notifications.message,
      payload: schema.notifications.payload,
    })
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId));
}

async function snapshot(userId: number): Promise<Set<string>> {
  return new Set((await notifRows(userId)).map((r) => r.id));
}

/** The DMs created for a user since `before` was taken. */
async function newRows(userId: number, before: Set<string>) {
  return (await notifRows(userId)).filter((r) => !before.has(r.id));
}

const voiceEmitsFor = (userId: number) =>
  voiceEmits.filter((e) => e.userId === userId);

function voiceDmCalls(userId: number): unknown[][] {
  return dispatchSpy.mock.calls.filter((c: unknown[]) => {
    const input = c[0] as { userId: number; payload?: { subtype?: string } };
    return (
      input.userId === userId && input.payload?.subtype === 'voice_access_lost'
    );
  });
}

const VOICE_PAYLOAD = expect.objectContaining({ subtype: 'voice_access_lost' });

describe('ROK-1769 one DM per removal — organizer removal', () => {
  it('private voice: ONE removal DM carrying the voice line, no second voice DM', async () => {
    const m = await rosteredOnPrivateEvent();
    const before = await snapshot(m.userId);
    await signups().adminRemoveSignup(
      m.eventId,
      m.signupId,
      testApp.seed.adminUser.id,
      true,
    );
    const rows = await newRows(m.userId, before);
    expect(voiceEmitsFor(m.userId)).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        type: 'slot_vacated',
        title: 'Removed from Event',
        message: `You were removed from ${m.title}\n\n${VOICE_ACCESS_LOST_LINE}`,
        payload: VOICE_PAYLOAD,
      }),
    );
    expect(voiceDmCalls(m.userId)).toHaveLength(1);
  });

  it('non-private voice: the plain removal DM, no voice line', async () => {
    const m = await rosteredOnPrivateEvent(false);
    const before = await snapshot(m.userId);
    await signups().adminRemoveSignup(
      m.eventId,
      m.signupId,
      testApp.seed.adminUser.id,
      true,
    );
    const rows = await newRows(m.userId, before);
    expect(voiceEmitsFor(m.userId)).toEqual([]);
    expect(rows.map((r) => [r.title, r.message])).toEqual([
      ['Removed from Event', `You were removed from ${m.title}`],
    ]);
    expect(rows[0]?.payload).not.toHaveProperty('subtype');
  });
});

describe('ROK-1769 one DM per removal — roster edit to bench', () => {
  it('private voice: ONE "Moved to Bench" DM carrying the voice line', async () => {
    const m = await rosteredOnPrivateEvent();
    const before = await snapshot(m.userId);
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
    await waitFor(async () => {
      expect(await newRows(m.userId, before)).toHaveLength(1);
    });
    const rows = await newRows(m.userId, before);
    expect(voiceEmitsFor(m.userId)).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        type: 'roster_reassigned',
        title: 'Moved to Bench',
        message: `You've been moved from ${formatRoleLabel('player')} to bench for ${m.title}\n\n${VOICE_ACCESS_LOST_LINE}`,
        payload: VOICE_PAYLOAD,
      }),
    );
  });

  it('a bench-only or declined member never had access', () => {
    expect(hadVoiceAccess('signed_up', 'bench')).toBe(false);
    expect(hadVoiceAccess('declined', 'player')).toBe(false);
    expect(hadVoiceAccess('tentative', null)).toBe(true);
  });
});

/** Full MMO roster (capacity 5) on a private-voice event, last dps tentative. */
async function fullPrivateRosterWithTentative() {
  const config = { type: 'mmo', tank: 1, healer: 1, dps: 3, flex: 0 };
  const eventId = await createMmoEvent(testApp, adminToken, config);
  await setPrivateVoice(eventId);
  const prefs = [['tank'], ['healer'], ['dps'], ['dps'], ['dps']];
  const members: { userId: number; signupId: number }[] = [];
  for (const [i, p] of prefs.entries()) {
    const name = `vfr${seq}_${i}`;
    const m = await createMemberAndLogin(testApp, name, `${name}@test.local`);
    const su = await signupWithPrefs(testApp, m.token, eventId, p);
    members.push({ userId: m.userId, signupId: su.id });
  }
  const victim = members[4];
  if (!victim) throw new Error('victim missing');
  await testApp.db
    .update(schema.eventSignups)
    .set({ status: 'tentative' })
    .where(eq(schema.eventSignups.id, victim.signupId));
  return { eventId, victim, title: await eventTitle(eventId) };
}

describe('ROK-1769 one DM per removal — tentative displaced to bench', () => {
  it('private voice: ONE displaced DM carrying the voice line', async () => {
    seq += 1;
    const r = await fullPrivateRosterWithTentative();
    const before = await snapshot(r.victim.userId);
    const nc = await createMemberAndLogin(
      testApp,
      `vfrnew${seq}`,
      `vfrnew${seq}@test.local`,
    );
    await signupWithPrefs(testApp, nc.token, r.eventId, ['dps']);
    await waitFor(async () => {
      expect(await newRows(r.victim.userId, before)).toHaveLength(1);
    });
    expect((await getSignupAssignment(testApp, r.victim.signupId))?.role).toBe(
      'bench',
    );
    const rows = await newRows(r.victim.userId, before);
    expect(voiceEmitsFor(r.victim.userId)).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        type: 'tentative_displaced',
        message: `A confirmed player took your dps slot in "${r.title}". You've been moved to the bench.\n\n${VOICE_ACCESS_LOST_LINE}`,
        payload: VOICE_PAYLOAD,
      }),
    );
  });
});

describe('ROK-1769 one DM per removal — departure', () => {
  it('departure sends the member no other DM, then exactly one voice DM', async () => {
    const m = await rosteredOnPrivateEvent();
    const now = Date.now();
    await testApp.db
      .update(schema.events)
      .set({
        duration: [new Date(now - 30 * 60_000), new Date(now + 2 * 3600_000)],
      })
      .where(eq(schema.events.id, m.eventId));
    const before = await snapshot(m.userId);
    const job = {
      data: { eventId: m.eventId, discordUserId: 'gone', signupId: m.signupId },
    } as Job<DepartureGraceJobData>;
    await testApp.app.get(DepartureGraceProcessor).process(job);
    const departed = {
      eventId: m.eventId,
      userId: m.userId,
      reason: 'departed' as const,
    };
    expect(voiceEmitsFor(m.userId)).toEqual([departed]);
    expect(await newRows(m.userId, before)).toEqual([]);
    expect(await listener().handle(departed)).toBe(true);
    const rows = await newRows(m.userId, before);
    expect(rows.map((r) => r.title)).toEqual(['Voice Channel Access Removed']);
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
      reason: 'departed' as const,
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
      reason: 'departed' as const,
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

async function setEventEphemeral(eventId: number, enabled: boolean | null) {
  await testApp.db
    .update(schema.events)
    .set({ ephemeralVoiceEnabled: enabled })
    .where(eq(schema.events.id, eventId));
}

const departedPayload = (m: { eventId: number; userId: number }) => ({
  eventId: m.eventId,
  userId: m.userId,
  reason: 'departed' as const,
});

describe('ROK-1769 voice-access gate — canonical ephemeral gate', () => {
  it('per-event null + global switch off: no voice DM, no voice line', async () => {
    const m = await rosteredOnPrivateEvent();
    await setEventEphemeral(m.eventId, null);
    await setEphemeralSwitches(false, true);
    expect(await listener().handle(departedPayload(m))).toBe(false);
    const before = await snapshot(m.userId);
    await signups().adminRemoveSignup(
      m.eventId,
      m.signupId,
      testApp.seed.adminUser.id,
      true,
    );
    expect(await newRows(m.userId, before)).toHaveLength(1);
    const [removal] = await newRows(m.userId, before);
    expect(removal?.message).not.toContain(VOICE_ACCESS_LOST_LINE);
    expect(voiceDmCalls(m.userId)).toEqual([]);
  });

  it('per-event null + global on + forced: the voice DM goes out', async () => {
    const m = await rosteredOnPrivateEvent();
    await setEventEphemeral(m.eventId, null);
    await setEphemeralSwitches(true, true);
    expect(await listener().handle(departedPayload(m))).toBe(true);
    expect(voiceDmCalls(m.userId)).toHaveLength(1);
  });

  it('per-event explicitly on but the global switch off: no voice DM', async () => {
    const m = await rosteredOnPrivateEvent();
    await setEphemeralSwitches(false, false);
    expect(await listener().handle(departedPayload(m))).toBe(false);
    expect(voiceDmCalls(m.userId)).toEqual([]);
  });
});

describe('ROK-1769 voice-access DM — re-join releases the dedupe', () => {
  it('a second departure after re-joining gets its own DM', async () => {
    const m = await rosteredOnPrivateEvent();
    await depart(m.eventId, m.signupId);
    expect(await listener().handle(departedPayload(m))).toBe(true);
    await signups().signup(m.eventId, m.userId);
    await waitFor(async () => {
      expect(await dedupRows(m.eventId, m.userId)).toBe(0);
    });
    await depart(m.eventId, m.signupId);
    expect(await listener().handle(departedPayload(m))).toBe(true);
    expect(voiceDmCalls(m.userId)).toHaveLength(2);
  });
});

async function depart(eventId: number, signupId: number) {
  await testApp.db
    .update(schema.eventSignups)
    .set({ status: 'departed' })
    .where(eq(schema.eventSignups.id, signupId));
  await moveToBench(testApp.db, signupId, eventId, new Logger('spec'));
}

async function dedupRows(eventId: number, userId: number): Promise<number> {
  const rows = await testApp.db
    .select({ key: schema.notificationDedup.dedupKey })
    .from(schema.notificationDedup)
    .where(
      eq(
        schema.notificationDedup.dedupKey,
        `voice-access-lost:event:${eventId}:user:${userId}`,
      ),
    );
  return rows.length;
}

describe('ROK-1769 one DM per removal — pool to bench', () => {
  it('a pool member moved to the bench gets the voice line on the assignment DM', async () => {
    const m = await rosteredOnPrivateEvent();
    await testApp.db
      .delete(schema.rosterAssignments)
      .where(eq(schema.rosterAssignments.signupId, m.signupId));
    const before = await snapshot(m.userId);
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
    await waitFor(async () => {
      expect(await newRows(m.userId, before)).toHaveLength(1);
    });
    const [row] = await newRows(m.userId, before);
    expect(row).toEqual(
      expect.objectContaining({
        type: 'roster_reassigned',
        title: 'Roster Assignment',
        message: `You've been assigned to the ${formatRoleLabel('bench')} role for ${m.title}\n\n${VOICE_ACCESS_LOST_LINE}`,
        payload: VOICE_PAYLOAD,
      }),
    );
  });
});
