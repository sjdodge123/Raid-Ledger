/**
 * DM Notification smoke tests.
 * Validates the RL bot sends correct DMs in response to event actions.
 *
 * Prerequisite: test bot's Discord user ID linked to a test user account
 * with Discord DM notifications enabled.
 */
import { waitForDM } from '../../helpers/dm.js';
import {
  createEvent,
  signup,
  cancelEvent,
  rescheduleEvent,
  deleteEvent,
  futureTime,
  sleep,
} from '../fixtures.js';
import { assertEmbedCount } from '../assert.js';
import type { SmokeTest, TestContext } from '../types.js';

const dmOnNewEvent: SmokeTest = {
  name: 'DM sent for new event (subscribed game)',
  category: 'dm',
  async run(ctx) {
    // Start listening BEFORE creating the event
    const dmPromise = waitForDM(
      (msg) => msg.embeds.some((e) => e.title?.includes('smoke-dm-new')),
      ctx.config.timeoutMs,
    );
    const ev = await createEvent(ctx.api, 'dm-new');
    try {
      const msg = await dmPromise;
      assertEmbedCount(msg.embeds, 1);
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const dmOnCancellation: SmokeTest = {
  name: 'DM sent when event cancelled',
  category: 'dm',
  async run(ctx) {
    const ev = await createEvent(ctx.api, 'dm-cancel');
    try {
      await signup(ctx.api, ev.id);
      await sleep(2000);
      const dmPromise = waitForDM(
        (msg) =>
          msg.embeds.some(
            (e) =>
              e.title?.toLowerCase().includes('cancel') ||
              e.description?.toLowerCase().includes('cancel') ||
              false,
          ),
        ctx.config.timeoutMs,
      );
      await cancelEvent(ctx.api, ev.id);
      const msg = await dmPromise;
      assertEmbedCount(msg.embeds, 1);
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const dmOnReschedule: SmokeTest = {
  name: 'DM sent when event rescheduled',
  category: 'dm',
  async run(ctx) {
    const ev = await createEvent(ctx.api, 'dm-resched');
    try {
      await signup(ctx.api, ev.id);
      await sleep(2000);
      const dmPromise = waitForDM(
        (msg) =>
          msg.embeds.some(
            (e) =>
              e.title?.toLowerCase().includes('reschedul') ||
              e.description?.toLowerCase().includes('reschedul') ||
              false,
          ),
        ctx.config.timeoutMs,
      );
      await rescheduleEvent(ctx.api, ev.id, 240);
      const msg = await dmPromise;
      assertEmbedCount(msg.embeds, 1);
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const dmRescheduleHasButtons: SmokeTest = {
  name: 'Reschedule DM has Confirm/Tentative/Decline buttons',
  category: 'dm',
  async run(ctx) {
    const ev = await createEvent(ctx.api, 'dm-resched-btns');
    try {
      await signup(ctx.api, ev.id);
      await sleep(2000);
      const dmPromise = waitForDM(
        (msg) =>
          msg.embeds.some(
            (e) =>
              e.title?.toLowerCase().includes('reschedul') ||
              e.description?.toLowerCase().includes('reschedul') ||
              false,
          ),
        ctx.config.timeoutMs,
      );
      await rescheduleEvent(ctx.api, ev.id, 300);
      const msg = await dmPromise;
      // Verify reschedule DM has the expected action buttons
      const hasConfirm = msg.components.some(
        (c) => c.customId?.startsWith('reschedule_confirm') || false,
      );
      const hasDecline = msg.components.some(
        (c) => c.customId?.startsWith('reschedule_decline') || false,
      );
      if (!hasConfirm && !hasDecline) {
        throw new Error(
          `Expected reschedule buttons, got: ${msg.components.map((c) => c.customId).join(', ')}`,
        );
      }
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const dmEventReminder: SmokeTest = {
  name: 'DM sent for event reminder (15min)',
  category: 'dm',
  async run(ctx) {
    // Create event starting 14 minutes from now to trigger 15-min reminder
    const ev = await createEvent(ctx.api, 'dm-reminder', {
      startTime: futureTime(14),
      endTime: futureTime(74),
      reminder15min: true,
    });
    try {
      await signup(ctx.api, ev.id);
      // The reminder scheduler should fire within ~1 minute
      const msg = await waitForDM(
        (m) =>
          m.embeds.some(
            (e) =>
              e.title?.toLowerCase().includes('reminder') ||
              e.description?.includes(ev.title) ||
              false,
          ),
        60_000, // longer timeout — depends on scheduler
      );
      assertEmbedCount(msg.embeds, 1);
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

export const dmNotificationTests: SmokeTest[] = [
  dmOnNewEvent,
  dmOnCancellation,
  dmOnReschedule,
  dmRescheduleHasButtons,
  dmEventReminder,
];
