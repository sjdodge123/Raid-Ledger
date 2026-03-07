/**
 * Demo Data — notification template definitions.
 * Extracted from demo-data.constants.ts for file size compliance.
 */

type NotifEntry = {
  userId: number;
  type: string;
  title: string;
  message: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  readAt: Date | null;
};

/** Helper to build a single notification entry. */
function entry(
  userId: number,
  type: string,
  title: string,
  message: string,
  payload: Record<string, unknown>,
  createdAt: Date,
  readAt: Date | null,
): NotifEntry {
  return { userId, type, title, message, payload, createdAt, readAt };
}

/** Build unread notification tuple definitions. */
function unreadDefs(
  events: { id: number; title: string }[],
  fakeUsers: { username: string }[],
): [string, string, string, Record<string, unknown>, number][] {
  const e = (i: number, fb: string) => events[i]?.title || fb;
  const u = fakeUsers[0]?.username || 'A player';
  return [
    [
      'slot_vacated',
      'Roster Slot Available',
      `A Tank slot opened up in "${e(0, 'Raid Night')}" - claim it now!`,
      { eventId: events[0]?.id, role: 'Tank', position: 1 },
      2,
    ],
    [
      'event_reminder',
      'Event Starting Soon',
      `"${e(1, 'Weekly Dungeon Run')}" starts in 24 hours. Don't forget to sign up!`,
      { eventId: events[1]?.id },
      5,
    ],
    [
      'new_event',
      'New Event Created',
      `${u} created a new event: "${e(2, 'PvP Tournament')}"`,
      { eventId: events[2]?.id },
      12,
    ],
  ];
}

/** Build the unread notification entries. */
function buildUnreadNotifications(
  uid: number,
  events: { id: number; title: string }[],
  fakeUsers: { username: string }[],
  hoursAgo: (h: number) => Date,
): NotifEntry[] {
  return unreadDefs(events, fakeUsers).map(([type, title, msg, payload, h]) =>
    entry(uid, type, title, msg, payload, hoursAgo(h), null),
  );
}

/** Helper: event title with fallback. */
function eventTitle(
  events: { id: number; title: string }[],
  i: number,
  fb: string,
) {
  return events[i]?.title || fb;
}

/** Build read notification tuple definitions. */
function readDefs(
  events: { id: number; title: string }[],
  hoursAgo: (h: number) => Date,
  daysAgo: (d: number) => Date,
): [string, string, string, Record<string, unknown>, Date, Date][] {
  return [
    readSubscribedGameDef(events, daysAgo, hoursAgo),
    readSlotVacatedDef(events, daysAgo),
    readEventReminderDef(events, daysAgo),
  ];
}

function readSubscribedGameDef(
  events: { id: number; title: string }[],
  daysAgo: (d: number) => Date,
  hoursAgo: (h: number) => Date,
): [string, string, string, Record<string, unknown>, Date, Date] {
  return [
    'subscribed_game',
    'New Event for Your Favorite Game',
    `A new Valheim event has been scheduled: "${eventTitle(events, 3, 'Boss Rush')}"`,
    { eventId: events[3]?.id, gameId: 'valheim' },
    daysAgo(1),
    hoursAgo(20),
  ];
}

function readSlotVacatedDef(
  events: { id: number; title: string }[],
  daysAgo: (d: number) => Date,
): [string, string, string, Record<string, unknown>, Date, Date] {
  return [
    'slot_vacated',
    'Healer Needed',
    `A Healer slot is available in "${eventTitle(events, 4, 'Mythic Raid')}"`,
    { eventId: events[4]?.id, role: 'Healer', position: 2 },
    daysAgo(2),
    daysAgo(1),
  ];
}

function readEventReminderDef(
  events: { id: number; title: string }[],
  daysAgo: (d: number) => Date,
): [string, string, string, Record<string, unknown>, Date, Date] {
  return [
    'event_reminder',
    'Event Tomorrow',
    `Don't forget about "${eventTitle(events, 0, 'Raid Night')}" tomorrow at 8 PM`,
    { eventId: events[0]?.id },
    daysAgo(3),
    daysAgo(2),
  ];
}

/** Build the read notification entries. */
function buildReadNotifications(
  uid: number,
  events: { id: number; title: string }[],
  hoursAgo: (h: number) => Date,
  daysAgo: (d: number) => Date,
): NotifEntry[] {
  return readDefs(events, hoursAgo, daysAgo).map(
    ([type, title, msg, payload, created, read]) =>
      entry(uid, type, title, msg, payload, created, read),
  );
}

/** Generate notification definitions (needs user/event IDs) */
export function getNotificationTemplates(
  adminUserId: number,
  events: { id: number; title: string }[],
  fakeUsers: { username: string }[],
) {
  const now = new Date();
  const hoursAgo = (hours: number) =>
    new Date(now.getTime() - hours * 60 * 60 * 1000);
  const daysAgo = (days: number) =>
    new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  return [
    ...buildUnreadNotifications(adminUserId, events, fakeUsers, hoursAgo),
    ...buildReadNotifications(adminUserId, events, hoursAgo, daysAgo),
  ];
}
