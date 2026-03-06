/**
 * Demo Data — notification template definitions.
 * Extracted from demo-data.constants.ts for file size compliance.
 */

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
    {
      userId: adminUserId,
      type: 'slot_vacated' as const,
      title: 'Roster Slot Available',
      message: `A Tank slot opened up in "${events[0]?.title || 'Raid Night'}" - claim it now!`,
      payload: { eventId: events[0]?.id, role: 'Tank', position: 1 },
      createdAt: hoursAgo(2),
      readAt: null,
    },
    {
      userId: adminUserId,
      type: 'event_reminder' as const,
      title: 'Event Starting Soon',
      message: `"${events[1]?.title || 'Weekly Dungeon Run'}" starts in 24 hours. Don't forget to sign up!`,
      payload: { eventId: events[1]?.id },
      createdAt: hoursAgo(5),
      readAt: null,
    },
    {
      userId: adminUserId,
      type: 'new_event' as const,
      title: 'New Event Created',
      message: `${fakeUsers[0]?.username || 'A player'} created a new event: "${events[2]?.title || 'PvP Tournament'}"`,
      payload: { eventId: events[2]?.id },
      createdAt: hoursAgo(12),
      readAt: null,
    },
    {
      userId: adminUserId,
      type: 'subscribed_game' as const,
      title: 'New Event for Your Favorite Game',
      message: `A new Valheim event has been scheduled: "${events[3]?.title || 'Boss Rush'}"`,
      payload: { eventId: events[3]?.id, gameId: 'valheim' },
      createdAt: daysAgo(1),
      readAt: hoursAgo(20),
    },
    {
      userId: adminUserId,
      type: 'slot_vacated' as const,
      title: 'Healer Needed',
      message: `A Healer slot is available in "${events[4]?.title || 'Mythic Raid'}"`,
      payload: { eventId: events[4]?.id, role: 'Healer', position: 2 },
      createdAt: daysAgo(2),
      readAt: daysAgo(1),
    },
    {
      userId: adminUserId,
      type: 'event_reminder' as const,
      title: 'Event Tomorrow',
      message: `Don't forget about "${events[0]?.title || 'Raid Night'}" tomorrow at 8 PM`,
      payload: { eventId: events[0]?.id },
      createdAt: daysAgo(3),
      readAt: daysAgo(2),
    },
  ];
}
