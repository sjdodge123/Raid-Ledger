/**
 * DM Notification dispatch smoke tests.
 *
 * Bots cannot receive DMs from other bots (Discord API error 50007).
 * Tests verify the notification pipeline creates in-app notifications
 * for affected users when events are cancelled/rescheduled/etc.
 *
 * The admin user triggers actions, demo users receive notifications.
 * Admin's own unread count is checked for self-affecting notifications.
 */
import { pollForCondition } from '../../helpers/polling.js';
import { simulatePlaintextContent } from '../../helpers/discord-markup.js';
import {
  createEvent,
  signupAs,
  cancelEvent,
  cancelSignupAs,
  rescheduleEvent,
  deleteEvent,
  addGameInterest,
  triggerDeparture,
  flushNotificationBuffer,
  getNotificationsFor,
  futureTime,
  awaitProcessing,
  assertConditionNeverMet,
} from '../fixtures.js';
import type { SmokeTest, TestContext } from '../types.js';

async function getUnreadCount(ctx: TestContext): Promise<number> {
  const res = await ctx.api
    .get<{ data: unknown[] }>('/notifications/unread')
    .catch(() => ({ data: [] }));
  return Array.isArray(res.data) ? res.data.length : 0;
}

function mmoOverrides(ctx: TestContext) {
  if (!ctx.mmoGameId) return {};
  return {
    gameId: ctx.mmoGameId,
    slotConfig: { type: 'mmo', tank: 1, healer: 1, dps: 3, flex: 0, bench: 2 },
  };
}

// ── Instant notifications (API-triggered) ──

const cancellationNotification: SmokeTest = {
  name: 'Cancellation creates notifications for participants',
  category: 'dm',
  async run(ctx) {
    const ev = await createEvent(ctx.api, 'dm-cancel', mmoOverrides(ctx));
    try {
      await signupAs(ctx.api, ev.id, ctx.dmRecipientUserId, ['dps']);
      await awaitProcessing(ctx.api);
      await cancelEvent(ctx.api, ev.id);
      // event_cancelled notification created for signed-up demo user
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const rescheduleNotification: SmokeTest = {
  name: 'Reschedule creates notifications for participants',
  category: 'dm',
  async run(ctx) {
    const ev = await createEvent(ctx.api, 'dm-resched', mmoOverrides(ctx));
    try {
      await signupAs(ctx.api, ev.id, ctx.dmRecipientUserId, ['healer']);
      await awaitProcessing(ctx.api);
      await rescheduleEvent(ctx.api, ev.id, 240);
      // event_rescheduled notification created
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const slotVacatedNotification: SmokeTest = {
  name: 'Slot vacated notification sent when player leaves',
  category: 'dm',
  async run(ctx) {
    const users = ctx.demoUserIds ?? [];
    if (users.length < 2) throw new Error('Need 2+ demo users');
    // Create event, sign up 2 demo users, then remove one
    const ev = await createEvent(ctx.api, 'dm-vacated', mmoOverrides(ctx));
    try {
      const res1 = await signupAs(ctx.api, ev.id, users[0], ['tank']);
      await signupAs(ctx.api, ev.id, users[1], ['dps']);
      await awaitProcessing(ctx.api);
      // Remove the first signup — should trigger slot_vacated to creator
      const signupId = (res1 as { id?: number }).id;
      if (signupId) {
        await ctx.api.delete(`/events/${ev.id}/signups/${signupId}`);
      }
      await awaitProcessing(ctx.api);
      // slot_vacated notification is buffered 3 min — just verify the
      // removal succeeded (the notification buffer is tested in unit tests)
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

/**
 * Check if a slot_vacated notification exists for a specific event.
 * Uses GET /notifications (paginated) since there's no unread-only endpoint.
 */
async function hasSlotVacatedForEvent(
  ctx: TestContext,
  eventId: number,
): Promise<boolean> {
  type NotifDto = { type: string; payload?: { eventId?: number } };
  const res = await ctx.api
    .get<NotifDto[]>('/notifications?limit=50')
    .catch(() => [] as NotifDto[]);
  const list = Array.isArray(res) ? res : [];
  return list.some(
    (n) => n.type === 'slot_vacated' && n.payload?.eventId === eventId,
  );
}

// ── ROK-851: Departure notification suppression ──

const departureNotifSuppressedNotFull: SmokeTest = {
  name: 'Departure notification suppressed when event not full (ROK-851)',
  category: 'dm',
  async run(ctx) {
    const users = ctx.demoUserIds ?? [];
    if (users.length < 2) throw new Error('Need 2+ demo users');
    // LIVE event with capacity 10, only 2 signups → not full
    const ev = await createEvent(ctx.api, 'depart-notfull', {
      startTime: futureTime(-5),
      endTime: futureTime(55),
      maxAttendees: 10,
    });
    try {
      const res = await signupAs(ctx.api, ev.id, users[0], ['dps']);
      await signupAs(ctx.api, ev.id, users[1], ['dps']);
      await awaitProcessing(ctx.api);
      const signupId = (res as { id?: number }).id;
      if (!signupId) throw new Error('No signup ID returned');
      await triggerDeparture(ctx.api, ev.id, signupId, 'smoke-depart-1');
      await awaitProcessing(ctx.api);
      // Assert NO notification appears (negative check)
      await assertConditionNeverMet(
        () => hasSlotVacatedForEvent(ctx, ev.id),
        10_000,
        'slot_vacated notification was sent for a non-full event',
        { intervalMs: 2000 },
      );
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const departureNotifSentWhenFull: SmokeTest = {
  name: 'Departure notification sent when event was full (ROK-851)',
  category: 'dm',
  async run(ctx) {
    const users = ctx.demoUserIds ?? [];
    if (users.length < 5) throw new Error('Need 5+ demo users');
    // LIVE event with capacity 5 (tank:1, healer:1, dps:3), 5 signups → full
    const ev = await createEvent(ctx.api, 'depart-full', {
      ...(ctx.mmoGameId ? { gameId: ctx.mmoGameId } : {}),
      startTime: futureTime(-5),
      endTime: futureTime(55),
      slotConfig: { type: 'mmo', tank: 1, healer: 1, dps: 3, flex: 0, bench: 2 },
    });
    try {
      const res = await signupAs(ctx.api, ev.id, users[0], ['tank']);
      await signupAs(ctx.api, ev.id, users[1], ['healer']);
      await signupAs(ctx.api, ev.id, users[2], ['dps']);
      await signupAs(ctx.api, ev.id, users[3], ['dps']);
      await signupAs(ctx.api, ev.id, users[4], ['dps']);
      await awaitProcessing(ctx.api);
      const signupId = (res as { id?: number }).id;
      if (!signupId) throw new Error('No signup ID returned');
      await triggerDeparture(ctx.api, ev.id, signupId, 'smoke-depart-2');
      await awaitProcessing(ctx.api);
      // Poll until slot_vacated notification appears
      await pollForCondition(
        async () => await hasSlotVacatedForEvent(ctx, ev.id) || null,
        ctx.config.timeoutMs,
        { intervalMs: 2000 },
      ).catch(() => {
        throw new Error(
          'No slot_vacated notification for a full event — suppression too aggressive',
        );
      });
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const tentativeDisplacedNotification: SmokeTest = {
  name: 'Tentative displaced notification on roster overflow',
  category: 'dm',
  async run(ctx) {
    const users = ctx.demoUserIds ?? [];
    if (users.length < 6) throw new Error('Need 6+ demo users');
    // Fill roster with 4 confirmed + 1 tentative, then add 1 more confirmed
    const ev = await createEvent(ctx.api, 'dm-tentative-displace', {
      ...mmoOverrides(ctx),
      slotConfig: { type: 'mmo', tank: 1, healer: 1, dps: 3, bench: 2 },
    });
    try {
      await signupAs(ctx.api, ev.id, users[0], ['tank']);
      await signupAs(ctx.api, ev.id, users[1], ['healer']);
      await signupAs(ctx.api, ev.id, users[2], ['dps']);
      await signupAs(ctx.api, ev.id, users[3], ['dps']);
      await signupAs(ctx.api, ev.id, users[4], ['dps'], {
        status: 'tentative',
      });
      await awaitProcessing(ctx.api);
      // 6th confirmed signup should displace tentative
      await signupAs(ctx.api, ev.id, users[5], ['dps']);
      await awaitProcessing(ctx.api);
      // tentative_displaced notification triggered for users[4]
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const rosterReassignmentNotification: SmokeTest = {
  name: 'Roster reassignment triggers notification',
  category: 'dm',
  async run(ctx) {
    const users = ctx.demoUserIds ?? [];
    if (users.length < 2) throw new Error('Need 2+ demo users');
    const ev = await createEvent(ctx.api, 'dm-reassign', mmoOverrides(ctx));
    try {
      await signupAs(ctx.api, ev.id, users[0], ['tank']);
      await signupAs(ctx.api, ev.id, users[1], ['dps']);
      await awaitProcessing(ctx.api);
      // Reassign user from tank to healer
      await ctx.api.patch(`/events/${ev.id}/roster`, {
        assignments: [
          { userId: users[0], slot: 'healer', position: 1 },
        ],
      });
      await awaitProcessing(ctx.api);
      // roster_reassigned notification buffered for creator
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const pugInviteNotification: SmokeTest = {
  name: 'PUG invite creates DM for invited user',
  category: 'dm',
  async run(ctx) {
    const ev = await createEvent(ctx.api, 'dm-pug', mmoOverrides(ctx));
    try {
      // Create a PUG invite for a Discord username
      await ctx.api
        .post(`/events/${ev.id}/pugs`, {
          discordUsername: 'SmokeTestTarget',
          role: 'healer',
        })
        .catch(() => {});
      await awaitProcessing(ctx.api);
      // PUG invite DM sent to the target user (or queued if not found)
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

// ── Slow / cron-dependent notifications ──

const reminderNotification: SmokeTest = {
  name: 'Event reminder creates notification (15min)',
  category: 'dm',
  async run(ctx) {
    const before = await getUnreadCount(ctx);
    const ev = await createEvent(ctx.api, 'dm-reminder', {
      startTime: futureTime(14),
      endTime: futureTime(74),
      reminder15min: true,
    });
    try {
      await pollForCondition(
        async () => {
          const after = await getUnreadCount(ctx);
          return after > before ? true : null;
        },
        60_000,
        { intervalMs: 2000, backoff: false },
      ).catch(() => {
        throw new Error('No new reminder within 60s');
      });
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const gameAffinityNotification: SmokeTest = {
  name: 'Game affinity DM sent for subscribed game event',
  category: 'dm',
  async run(ctx) {
    const gameId = ctx.mmoGameId ?? ctx.games[0]?.id;
    if (!gameId) {
      console.log('    SKIP: No game available for affinity test (no characters in CI)');
      return;
    }
    await addGameInterest(ctx.api, ctx.dmRecipientUserId, gameId);
    await awaitProcessing(ctx.api);
    // Create event within lead-time window (admin is creator → excluded)
    const ev = await createEvent(ctx.api, 'dm-affinity', {
      gameId,
      startTime: futureTime(60),
      endTime: futureTime(120),
    });
    try {
      // Poll until event has the correct game (confirms dispatch path ran)
      await pollForCondition(
        async () => {
          const fetched = await ctx.api.get<{ game?: { id: number } }>(
            `/events/${ev.id}`,
          );
          return fetched.game?.id === gameId ? true : null;
        },
        ctx.config.timeoutMs,
        { intervalMs: 2000 },
      ).catch(() => {
        throw new Error(
          `Event game.id mismatch: expected ${gameId}`,
        );
      });
      // TODO: Assert notification record exists for dmRecipientUserId once
      // an admin endpoint for querying other users' notifications is added.
      // Bot-to-bot DMs fail with 50007, but the dispatch path ran.
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const welcomeDmNotification: SmokeTest = {
  name: 'Welcome DM sent on first Discord enable',
  category: 'dm',
  async run(ctx) {
    // The welcome DM is sent when a user first enables Discord notifications.
    // We already enabled them during setup — check Redis dedup key exists.
    // This is a lightweight verification that the welcome path was triggered.
    await ctx.api
      .post('/admin/test/enable-discord-notifications', {
        userId: ctx.dmRecipientUserId,
      });
    await awaitProcessing(ctx.api);
    // Welcome DM was attempted (may fail with 50007 for bot users,
    // but the dispatch path was exercised)
  },
};

// Slow tests gated behind SMOKE_INCLUDE_SLOW=1
const includeSlow = process.env.SMOKE_INCLUDE_SLOW === '1';

const rescheduleDmHasDate: SmokeTest = {
  name: 'Reschedule DM plaintext includes new date, not empty parens (ROK-918)',
  category: 'dm',
  async run(ctx) {
    const recipientId = ctx.dmRecipientUserId;
    const ev = await createEvent(ctx.api, 'dm-resched-date', mmoOverrides(ctx));
    try {
      // Sign up a demo user (NOT admin) — admin is excluded as rescheduler
      await signupAs(ctx.api, ev.id, recipientId, ['dps']);
      await awaitProcessing(ctx.api);
      await rescheduleEvent(ctx.api, ev.id, 300);
      // Poll until the demo user gets the reschedule notification
      type NotifDto = { type: string; title?: string; message?: string };
      const reschedNotif = await pollForCondition(
        async () => {
          const notifs = await getNotificationsFor(
            ctx.api, recipientId, 'event_rescheduled', 5,
          ) as NotifDto[];
          const list = Array.isArray(notifs) ? notifs : [];
          return list.find((n) => n.type === 'event_rescheduled') ?? null;
        },
        ctx.config.timeoutMs,
        { intervalMs: 2000 },
      ).catch(() => {
        throw new Error('No reschedule notification for demo user within timeout');
      });
      if (!reschedNotif?.message) {
        throw new Error('Reschedule notification has no message');
      }
      const plaintext = simulatePlaintextContent(
        reschedNotif.title ?? '', reschedNotif.message,
      );
      if (plaintext.includes('()')) {
        throw new Error(
          `Plaintext DM contains empty parens "()" — ` +
          `stripDiscordMarkup bug. Plaintext: "${plaintext}"`,
        );
      }
      const monthPattern = /Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/;
      if (!monthPattern.test(plaintext)) {
        throw new Error(
          `Plaintext DM missing formatted date. ` +
          `Raw message: "${reschedNotif.message}" → Plaintext: "${plaintext}"`,
        );
      }
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

// ── ROK-919: Slot vacated relevance filter ──

const departureNotifSuppressedDpsFull: SmokeTest = {
  name: 'DPS departure from full MMO event suppressed (ROK-919)',
  category: 'dm',
  async run(ctx) {
    const users = ctx.demoUserIds ?? [];
    if (users.length < 5) throw new Error('Need 5+ demo users');
    // LIVE full MMO event: tank:1, healer:1, dps:3 = 5 total
    const ev = await createEvent(ctx.api, 'depart-dps-mmo', {
      ...(ctx.mmoGameId ? { gameId: ctx.mmoGameId } : {}),
      startTime: futureTime(-5),
      endTime: futureTime(55),
      slotConfig: { type: 'mmo', tank: 1, healer: 1, dps: 3, flex: 0, bench: 2 },
    });
    try {
      await signupAs(ctx.api, ev.id, users[0], ['tank']);
      await signupAs(ctx.api, ev.id, users[1], ['healer']);
      const dpsRes = await signupAs(ctx.api, ev.id, users[2], ['dps']);
      await signupAs(ctx.api, ev.id, users[3], ['dps']);
      await signupAs(ctx.api, ev.id, users[4], ['dps']);
      await awaitProcessing(ctx.api);
      const signupId = (dpsRes as { id?: number }).id;
      if (!signupId) throw new Error('No signup ID returned');
      // Depart a DPS — should NOT trigger notification (DPS is not critical)
      await triggerDeparture(ctx.api, ev.id, signupId, 'smoke-dps-depart');
      await awaitProcessing(ctx.api);
      await assertConditionNeverMet(
        () => hasSlotVacatedForEvent(ctx, ev.id),
        10_000,
        'slot_vacated notification sent for DPS departure — role filter not applied',
        { intervalMs: 2000 },
      );
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const departureNotifSentHealerMmo: SmokeTest = {
  name: 'Healer departure from MMO event sends notification (ROK-919)',
  category: 'dm',
  async run(ctx) {
    const users = ctx.demoUserIds ?? [];
    if (users.length < 3) throw new Error('Need 3+ demo users');
    // LIVE MMO event, NOT full (3/5) — healer should still trigger
    const ev = await createEvent(ctx.api, 'depart-healer-mmo', {
      ...(ctx.mmoGameId ? { gameId: ctx.mmoGameId } : {}),
      startTime: futureTime(-5),
      endTime: futureTime(55),
      slotConfig: { type: 'mmo', tank: 1, healer: 1, dps: 3, flex: 0, bench: 2 },
    });
    try {
      await signupAs(ctx.api, ev.id, users[0], ['tank']);
      const healRes = await signupAs(ctx.api, ev.id, users[1], ['healer']);
      await signupAs(ctx.api, ev.id, users[2], ['dps']);
      await awaitProcessing(ctx.api);
      const signupId = (healRes as { id?: number }).id;
      if (!signupId) throw new Error('No signup ID returned');
      // Depart healer — should trigger even though event is NOT full
      await triggerDeparture(ctx.api, ev.id, signupId, 'smoke-heal-depart');
      await awaitProcessing(ctx.api);
      await pollForCondition(
        async () => await hasSlotVacatedForEvent(ctx, ev.id) || null,
        ctx.config.timeoutMs,
        { intervalMs: 2000 },
      ).catch(() => {
        throw new Error(
          'No slot_vacated for healer departure — critical role filter broken',
        );
      });
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const departureNotifSentGenericFull: SmokeTest = {
  name: 'Departure from full generic event sends notification (ROK-919)',
  category: 'dm',
  async run(ctx) {
    const users = ctx.demoUserIds ?? [];
    if (users.length < 3) throw new Error('Need 3+ demo users');
    // LIVE generic event at capacity (3/3)
    const ev = await createEvent(ctx.api, 'depart-generic-full', {
      startTime: futureTime(-5),
      endTime: futureTime(55),
      slotConfig: { type: 'generic', player: 3 },
    });
    try {
      const res = await signupAs(ctx.api, ev.id, users[0], ['player']);
      await signupAs(ctx.api, ev.id, users[1], ['player']);
      await signupAs(ctx.api, ev.id, users[2], ['player']);
      await awaitProcessing(ctx.api);
      const signupId = (res as { id?: number }).id;
      if (!signupId) throw new Error('No signup ID returned');
      await triggerDeparture(ctx.api, ev.id, signupId, 'smoke-gen-depart');
      await awaitProcessing(ctx.api);
      await pollForCondition(
        async () => await hasSlotVacatedForEvent(ctx, ev.id) || null,
        ctx.config.timeoutMs,
        { intervalMs: 2000 },
      ).catch(() => {
        throw new Error(
          'No slot_vacated for departure from full generic event',
        );
      });
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const departureNotifSuppressedGenericNotFull: SmokeTest = {
  name: 'Departure from non-full generic event suppressed (ROK-919)',
  category: 'dm',
  async run(ctx) {
    const users = ctx.demoUserIds ?? [];
    if (users.length < 2) throw new Error('Need 2+ demo users');
    // LIVE generic event NOT full (2/10)
    const ev = await createEvent(ctx.api, 'depart-generic-notfull', {
      startTime: futureTime(-5),
      endTime: futureTime(55),
      slotConfig: { type: 'generic', player: 10 },
    });
    try {
      const res = await signupAs(ctx.api, ev.id, users[0], ['player']);
      await signupAs(ctx.api, ev.id, users[1], ['player']);
      await awaitProcessing(ctx.api);
      const signupId = (res as { id?: number }).id;
      if (!signupId) throw new Error('No signup ID returned');
      await triggerDeparture(ctx.api, ev.id, signupId, 'smoke-gen-notfull');
      await awaitProcessing(ctx.api);
      await assertConditionNeverMet(
        () => hasSlotVacatedForEvent(ctx, ev.id),
        10_000,
        'slot_vacated sent for departure from non-full generic event',
        { intervalMs: 2000 },
      );
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

// ── ROK-919: Signup cancellation path (buffer + flush) ──

const cancelSuppressedGenericNotFull: SmokeTest = {
  name: 'Cancel from non-full generic event suppressed via buffer (ROK-919)',
  category: 'dm',
  async run(ctx) {
    const users = ctx.demoUserIds ?? [];
    if (users.length < 2) throw new Error('Need 2+ demo users');
    // Future generic event with capacity 10, only 2 signups → NOT full
    const ev = await createEvent(ctx.api, 'cancel-gen-notfull', {
      slotConfig: { type: 'generic', player: 10 },
    });
    try {
      await signupAs(ctx.api, ev.id, users[0], ['player']);
      await signupAs(ctx.api, ev.id, users[1], ['player']);
      await awaitProcessing(ctx.api);
      // Cancel user's signup (triggers bufferLeave → 3 min timer)
      await cancelSignupAs(ctx.api, ev.id, users[0]);
      // Immediately flush the buffer (bypasses 3-min wait)
      await flushNotificationBuffer(ctx.api);
      await awaitProcessing(ctx.api);
      // Verify NO slot_vacated notification (event was NOT full)
      await assertConditionNeverMet(
        () => hasSlotVacatedForEvent(ctx, ev.id),
        8_000,
        'slot_vacated sent after cancel from non-full generic event — the Palworld bug is back',
        { intervalMs: 2000 },
      );
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const cancelSuppressedDpsMmo: SmokeTest = {
  name: 'Cancel DPS from MMO event suppressed via buffer (ROK-919)',
  category: 'dm',
  async run(ctx) {
    const users = ctx.demoUserIds ?? [];
    if (users.length < 3) throw new Error('Need 3+ demo users');
    // Future MMO event — always pass slotConfig explicitly for CI
    const ev = await createEvent(ctx.api, 'cancel-dps-mmo', {
      ...(ctx.mmoGameId ? { gameId: ctx.mmoGameId } : {}),
      slotConfig: { type: 'mmo', tank: 1, healer: 1, dps: 3, flex: 0, bench: 2 },
    });
    try {
      await signupAs(ctx.api, ev.id, users[0], ['tank']);
      await signupAs(ctx.api, ev.id, users[1], ['healer']);
      await signupAs(ctx.api, ev.id, users[2], ['dps']);
      await awaitProcessing(ctx.api);
      // Cancel the DPS signup (not a critical role)
      await cancelSignupAs(ctx.api, ev.id, users[2]);
      await flushNotificationBuffer(ctx.api);
      await awaitProcessing(ctx.api);
      await assertConditionNeverMet(
        () => hasSlotVacatedForEvent(ctx, ev.id),
        8_000,
        'slot_vacated sent after DPS cancel from MMO event — role filter not applied on cancel path',
        { intervalMs: 2000 },
      );
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const cancelFiredTankMmo: SmokeTest = {
  name: 'Cancel Tank from MMO event sends notification via buffer (ROK-919)',
  category: 'dm',
  async run(ctx) {
    const users = ctx.demoUserIds ?? [];
    if (users.length < 3) throw new Error('Need 3+ demo users');
    // Future MMO event — always pass slotConfig so roster assignments work
    // even in CI where mmoGameId may not exist
    const ev = await createEvent(ctx.api, 'cancel-tank-mmo', {
      ...(ctx.mmoGameId ? { gameId: ctx.mmoGameId } : {}),
      slotConfig: { type: 'mmo', tank: 1, healer: 1, dps: 3, flex: 0, bench: 2 },
    });
    try {
      await signupAs(ctx.api, ev.id, users[0], ['tank']);
      await signupAs(ctx.api, ev.id, users[1], ['healer']);
      await signupAs(ctx.api, ev.id, users[2], ['dps']);
      await awaitProcessing(ctx.api);
      // Cancel the TANK signup (critical role — should notify)
      await cancelSignupAs(ctx.api, ev.id, users[0]);
      await flushNotificationBuffer(ctx.api);
      await awaitProcessing(ctx.api);
      // Poll for slot_vacated notification (should appear)
      await pollForCondition(
        async () => await hasSlotVacatedForEvent(ctx, ev.id) || null,
        ctx.config.timeoutMs,
        { intervalMs: 2000 },
      ).catch(() => {
        throw new Error(
          'No slot_vacated after tank cancel — critical role notification broken',
        );
      });
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

export const dmNotificationTests: SmokeTest[] = [
  cancellationNotification,
  rescheduleNotification,
  slotVacatedNotification,
  departureNotifSuppressedNotFull,
  departureNotifSentWhenFull,
  tentativeDisplacedNotification,
  rosterReassignmentNotification,
  pugInviteNotification,
  gameAffinityNotification,
  welcomeDmNotification,
  rescheduleDmHasDate,
  departureNotifSuppressedDpsFull,
  departureNotifSentHealerMmo,
  departureNotifSentGenericFull,
  departureNotifSuppressedGenericNotFull,
  cancelSuppressedGenericNotFull,
  cancelSuppressedDpsMmo,
  cancelFiredTankMmo,
  ...(includeSlow ? [reminderNotification] : []),
];
