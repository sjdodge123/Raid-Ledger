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
 * End-to-end flow exercised (M2 → M3 prompt → M4 event-path fan-out):
 *  1. Admin creates an already-ended event E (effective end ~15 min ago) and
 *     signs up the DM-recipient demo user as an attendee.
 *  2. `trigger-post-event-followup` fires the M2 cron → records the follow-up
 *     sentinel for E and DMs the organizer the prompt. (The sentinel is a hard
 *     prerequisite for step 4 — if the cron did not run, the fan-out no-ops and
 *     this test fails, so the assertion transitively proves the cron fired.)
 *  3. The organizer "clicks [Schedule event]" → the web form POSTs a follow-up
 *     event F carrying `followupForEventId = E.id`.
 *  4. The server post-create hook fans out to E's attendees.
 *  5. Assert: the attendee receives a `post_event_followup` notification whose
 *     `payload.eventId === F.id`; the organizer (admin) receives none
 *     (HARD CONSTRAINT 8 — organizer excluded from part-(b) invites).
 *
 * E is created already-ended (rather than via `set-event-times`) on purpose:
 * `set-event-times` is a raw DB write that does NOT emit an event-lifecycle
 * refresh, so the M2 cron's `ActiveEventCache` pre-gate would not see the new
 * past end time. Creating E already-ended makes the cache correct on the
 * CREATED refresh, keeping the test deterministic.
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

/** Times for an event whose effective end fell ~15 min ago (M2 cron window). */
function endedTimes(): { startTime: string; endTime: string } {
  return {
    startTime: new Date(Date.now() - 75 * 60 * 1000).toISOString(),
    endTime: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
  };
}

/** Fire the post-event follow-up cron once (DEMO_MODE test hook). */
async function triggerFollowupCron(api: ApiClient): Promise<void> {
  await api.post('/admin/test/trigger-post-event-followup', {});
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
    const ended = await createEvent(ctx.api, 'pef-ended', {
      ...endedTimes(),
      ...(gameId ? { gameId } : {}),
    });
    let followupId: number | undefined;
    try {
      // A couple of rostered signups on the ended event.
      await signupAs(ctx.api, ended.id, recipient);
      const buddy = ctx.demoUserIds?.[0];
      if (buddy) await signupAs(ctx.api, ended.id, buddy);
      await awaitProcessing(ctx.api);

      // M2/M3: the cron records the follow-up sentinel + prompts the organizer.
      await triggerFollowupCron(ctx.api);
      await awaitProcessing(ctx.api);

      // M3/M4 event path: organizer "clicks [Schedule event]" → the web form
      // POSTs a follow-up event carrying followupForEventId → server fan-out.
      const followup = await createEvent(ctx.api, 'pef-followup', {
        ...(gameId ? { gameId } : {}),
        followupForEventId: ended.id,
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
            `(follow-up event ${followup.id}) — M2→M4 event path did not deliver`,
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
      await deleteEvent(ctx.api, ended.id);
      if (followupId) await deleteEvent(ctx.api, followupId);
    }
  },
};

export const postEventFollowupTests: SmokeTest[] = [
  attendeeInvitedAfterFollowupScheduled,
];
