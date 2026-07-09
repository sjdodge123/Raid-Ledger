/**
 * ROK-1371 — Post-event follow-up prompt + attendee quick-sign-up invites.
 *
 * Discord disallows bot-to-bot DMs (error 50007), so the organizer prompt DM
 * ("Schedule a follow-up?" — a direct DM with no in-app mirror) cannot be read
 * back by the companion bot. The attendee fan-out (M4), however, routes through
 * `NotificationService.createMany`, which persists an in-app
 * `post_event_followup` notification mirroring the Discord DM. We verify via
 * that mirror at `/admin/test/notifications` — the same approach used by
 * `lineup-private-dm.test.ts` and `recruitment-reminder.test.ts`.
 *
 * This test owns the M4 event-path DELIVERY. The event-path fan-out
 * (`runFollowupFanout`) starts with a `claimFanout` UPDATE on the
 * `post_event_followup_sent` sentinel and no-ops if the row is absent. Rather
 * than race the M2 cron that normally records that sentinel (its
 * ActiveEventCache + ~14–16min detection window is timing-sensitive on a loaded
 * CI runner — see the git history of this file), we record the sentinel
 * deterministically via `/admin/test/record-followup-sentinel`. M2 candidate
 * detection is covered separately by the api integration suite.
 *
 * Flow:
 *  1. Admin creates event E and rosters the DM-recipient demo user + a buddy.
 *  2. Record E's follow-up sentinel deterministically (simulates "organizer was
 *     prompted").
 *  3. Organizer "clicks [Schedule event]" → the web form POSTs a follow-up event
 *     F carrying `followupForEventId = E.id`; the server post-create hook fans
 *     out to E's rostered attendees (claiming the sentinel).
 *  4. Assert: the attendee receives a `post_event_followup` notification whose
 *     `payload.eventId === F.id`; the organizer (admin) receives none
 *     (HARD CONSTRAINT 8 — organizer excluded from part-(b) invites).
 */
import { pollForCondition } from '../../helpers/polling.js';
import {
  awaitProcessing,
  createEvent,
  deleteEvent,
  getNotificationsFor,
  signupAs,
} from '../fixtures.js';
import type { ApiClient } from '../api.js';
import type { SmokeTest, TestContext } from '../types.js';

interface FollowupNotification {
  type: string;
  payload?: { eventId?: number } | null;
}

/** Deterministically record the `post_event_followup_sent` sentinel the
 *  event-path fan-out claims — DEMO_MODE hook, avoids racing the M2 cron. */
async function recordFollowupSentinel(
  api: ApiClient,
  eventId: number,
): Promise<void> {
  await api.post('/admin/test/record-followup-sentinel', { eventId });
}

/** True when `userId` has a post_event_followup notification for `eventId`. */
async function hasFollowupInvite(
  ctx: TestContext,
  userId: number,
  eventId: number,
): Promise<boolean> {
  const list = (await getNotificationsFor(
    ctx.api,
    userId,
    'post_event_followup',
    25,
  ).catch(() => [] as FollowupNotification[])) as FollowupNotification[];
  return list.some((n) => n.payload?.eventId === eventId);
}

const attendeeInvitedAfterFollowupScheduled: SmokeTest = {
  name: 'ROK-1371: attendee is invited after the organizer schedules a follow-up',
  category: 'dm',
  async run(ctx: TestContext) {
    const recipient = ctx.dmRecipientUserId;
    if (recipient === ctx.testUserId) {
      console.log('    SKIP: no distinct DM-recipient demo user available');
      return;
    }
    const gameId = ctx.mmoGameId ?? ctx.games[0]?.id;
    const source = await createEvent(ctx.api, 'pef-source', {
      ...(gameId ? { gameId } : {}),
    });
    let followupId: number | undefined;
    try {
      // Roster a couple of signups on the source event.
      await signupAs(ctx.api, source.id, recipient);
      const buddy = ctx.demoUserIds?.[0];
      if (buddy) await signupAs(ctx.api, source.id, buddy);

      // Deterministically record the sentinel the event-path fan-out claims
      // (simulates "organizer prompted"); no cron-timing race.
      await recordFollowupSentinel(ctx.api, source.id);
      await awaitProcessing(ctx.api);

      // Event path: organizer "clicks [Schedule event]" → the web form POSTs a
      // follow-up event carrying followupForEventId → server post-create fan-out.
      const followup = await createEvent(ctx.api, 'pef-followup', {
        ...(gameId ? { gameId } : {}),
        followupForEventId: source.id,
      });
      followupId = followup.id;
      await awaitProcessing(ctx.api);

      // M4-AC1: the rostered attendee receives the quick-sign-up invite whose
      // payload points at the newly-created follow-up event.
      await pollForCondition(
        async () =>
          (await hasFollowupInvite(ctx, recipient, followup.id)) || null,
        ctx.config.timeoutMs,
        { intervalMs: 2000 },
      ).catch(() => {
        throw new Error(
          `No post_event_followup invite for attendee ${recipient} ` +
            `(follow-up event ${followup.id}) — M4 event-path fan-out did not deliver`,
        );
      });

      // M4-AC3 / HARD CONSTRAINT 8: the organizer (admin) is excluded from
      // part-(b) attendee invites.
      const organizerInvited = await hasFollowupInvite(
        ctx,
        ctx.testUserId,
        followup.id,
      );
      if (organizerInvited) {
        throw new Error(
          'Organizer wrongly received a post_event_followup attendee invite',
        );
      }
    } finally {
      await deleteEvent(ctx.api, source.id);
      if (followupId) await deleteEvent(ctx.api, followupId);
    }
  },
};

export const postEventFollowupTests: SmokeTest[] = [
  attendeeInvitedAfterFollowupScheduled,
];
