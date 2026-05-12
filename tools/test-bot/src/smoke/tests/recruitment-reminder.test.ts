/**
 * ROK-1240 — short-notice / same-day recruitment reminder suppression.
 *
 * The "Spots still available" channel reminder + recruitment DM both
 * run through `RecruitmentReminderService.checkAndSendReminders` on a
 * 15-minute cron. Pre-fix, an event scheduled for the same day as it
 * was created (e.g. created 3pm, starts 9pm) would still post a
 * channel embed reading "event tomorrow" — both the cadence (firing
 * for short-notice events at all) and the copy ("tomorrow" for a
 * same-day event) were wrong.
 *
 * This smoke test verifies the cadence half end-to-end:
 *  1. Create an event scheduled within the short-notice threshold
 *     (default 12h). createdAt is "now", startTime is 4h out.
 *  2. Add a game interest so the recipient WOULD have been DM'd
 *     before the fix.
 *  3. Trigger the recruitment cron.
 *  4. Assert: channel never receives a "Spots still available" embed.
 *  5. Assert: dmRecipientUserId never receives a `recruitment_reminder`
 *     notification.
 *
 * Bot DM rationale: companion bot can't receive DMs from another bot
 * (Discord 50007). The in-app notification mirror at
 * `/admin/test/notifications` is the canonical proof of dispatch —
 * same approach used by `lineup-tiebreaker-open.test.ts` and
 * `standalone-poll-reminders.test.ts`.
 */
import { readLastMessages } from '../../helpers/messages.js';
import {
  addGameInterest,
  assertConditionNeverMet,
  awaitProcessing,
  createEvent,
  deleteEvent,
  futureTime,
  getNotificationsFor,
} from '../fixtures.js';
import type { ApiClient } from '../api.js';
import type { SmokeTest, TestContext } from '../types.js';

interface EventResponse {
  id: number;
  title: string;
  [k: string]: unknown;
}

async function triggerRecruitmentCron(api: ApiClient): Promise<void> {
  await api.post('/admin/test/trigger-recruitment-reminders', {});
}

async function hasRecruitmentReminderForRecipient(
  ctx: TestContext,
  eventId: number,
): Promise<boolean> {
  const list = await getNotificationsFor(
    ctx.api,
    ctx.dmRecipientUserId,
    'recruitment_reminder',
    25,
  ).catch(() => [] as { type: string; payload?: Record<string, unknown> }[]);
  return list.some((n) => n.payload?.eventId === eventId);
}

async function hasRecruitmentBumpInChannel(
  channelId: string,
  eventTitle: string,
): Promise<boolean> {
  const msgs = await readLastMessages(channelId, 25);
  return msgs.some((m) =>
    m.embeds.some((e) => {
      const title = e.title ?? '';
      const desc = e.description ?? '';
      return (
        /spots still available/i.test(title) && desc.includes(eventTitle)
      );
    }),
  );
}

const shortNoticeSuppressesBothPaths: SmokeTest = {
  name: 'Same-day event suppresses recruitment bump + DM (ROK-1240)',
  category: 'embed',
  async run(ctx: TestContext) {
    const gameId = ctx.mmoGameId ?? ctx.games[0]?.id;
    if (!gameId) {
      console.log(
        '    SKIP: No game available for short-notice suppression test',
      );
      return;
    }

    // Wire up game interest so the recipient WOULD be DM'd if the
    // suppression rule didn't fire. Without this the negative
    // assertion is meaningless (no recipient candidates either way).
    await addGameInterest(ctx.api, ctx.dmRecipientUserId, gameId);
    await awaitProcessing(ctx.api);

    // 4h to start = well below the 12h short-notice threshold.
    // createdAt will be "now" because we just POST'd /events.
    const ev = await createEvent(ctx.api, 'rok1240-shortnotice', {
      gameId,
      startTime: futureTime(4 * 60),
      endTime: futureTime(5 * 60),
    });
    const event = ev as EventResponse;

    try {
      await awaitProcessing(ctx.api);

      // Run the recruitment cron once. Pre-fix, this would post a
      // channel embed AND insert a recruitment_reminder notification
      // for our recipient.
      await triggerRecruitmentCron(ctx.api);
      await awaitProcessing(ctx.api);

      // Negative assertion #1: channel must NOT receive the bump.
      // 8s window is plenty — the cron path is synchronous.
      await assertConditionNeverMet(
        () => hasRecruitmentBumpInChannel(ctx.defaultChannelId, event.title),
        8_000,
        `Channel received "Spots still available" embed for short-notice event "${event.title}" — expected suppression`,
        { intervalMs: 2000 },
      );

      // Negative assertion #2: no recruitment_reminder notification
      // for the would-be recipient.
      await assertConditionNeverMet(
        () => hasRecruitmentReminderForRecipient(ctx, event.id),
        4_000,
        `Recipient received recruitment_reminder notification for short-notice event ${event.id} — expected suppression`,
        { intervalMs: 1500 },
      );
    } finally {
      await deleteEvent(ctx.api, event.id);
    }
  },
};

export const recruitmentReminderTests: SmokeTest[] = [
  shortNoticeSuppressesBothPaths,
];
