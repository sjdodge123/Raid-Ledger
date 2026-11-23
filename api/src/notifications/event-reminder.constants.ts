/**
 * Reminder window definitions for EventReminderService.
 *
 * Split out of the service (ROK-1201) — it is a data table, and the service
 * hit the 300-line file cap once per-phase timing landed.
 */
export const REMINDER_WINDOWS = [
  {
    type: '15min',
    label: '15 Minutes',
    ms: 15 * 60 * 1000,
    fieldKey: 'reminder15min' as const,
  },
  {
    type: '1hour',
    label: '1 Hour',
    ms: 60 * 60 * 1000,
    fieldKey: 'reminder1hour' as const,
  },
  {
    type: '24hour',
    label: '24 Hours',
    ms: 24 * 60 * 60 * 1000,
    fieldKey: 'reminder24hour' as const,
  },
] as const;

export type ReminderWindowType = (typeof REMINDER_WINDOWS)[number]['type'];

/**
 * A recipient whose signup became active this recently gets no DM for the
 * window being dispatched (ROK-2293): they just signed up and already know
 * when the event starts. The window's dedup row is still claimed, so that
 * window never fires later; the next window behaves normally.
 */
export const REMINDER_FRESH_SIGNUP_GRACE_MS = 15 * 60 * 1000;
