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
