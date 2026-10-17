/**
 * Displaced-tentative DM (ROK-459), split from signups-tentative.helpers.ts
 * for file size. ROK-1769: a move to the bench carries the private-voice line.
 */
import { eq } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type {
  DisplacedNotificationParams,
  DisplacedDestination,
} from './signups.service.types';
import type { NotificationService } from '../notifications/notification.service';
import {
  withVoiceAccessLine,
  type VoiceGateSettings,
} from '../notifications/voice-access-lost.helpers';

const DISPLACED_ACTION: Record<DisplacedDestination, (r?: string) => string> = {
  role: (r) => `moved to ${r}`,
  bench: () => 'moved to the bench',
  pool: () => 'moved to the unassigned pool',
};

export async function sendDisplacedNotification(
  p: DisplacedNotificationParams,
  notificationService: NotificationService,
  fetchNotificationCtx: (eventId: number) => Promise<Record<string, string>>,
  settings: VoiceGateSettings,
) {
  const { db, eventId, role, rearrangedToRole } = p;
  const target = await loadDisplacedTarget(db, eventId, p.victimSignupId);
  if (!target) return;
  const action = DISPLACED_ACTION[p.destination](rearrangedToRole);
  const extraPayload = await fetchNotificationCtx(eventId);
  const input = {
    userId: target.userId,
    type: 'tentative_displaced' as const,
    title: 'Roster update',
    message: `A confirmed player took your ${role} slot in "${target.eventTitle}". You've been ${action}.`,
    payload: { eventId, ...extraPayload },
  };
  // ROK-1769 one-DM rule: benched off a private-voice roster → voice line.
  await notificationService.create(
    p.destination === 'bench'
      ? await withVoiceAccessLine({ db, settings }, eventId, input)
      : input,
  );
}

/** The displaced member's user id + event title; null for an anonymous row. */
async function loadDisplacedTarget(
  db: DisplacedNotificationParams['db'],
  eventId: number,
  victimSignupId: number,
): Promise<{ userId: number; eventTitle: string } | null> {
  const [signup] = await db
    .select({ userId: schema.eventSignups.userId })
    .from(schema.eventSignups)
    .where(eq(schema.eventSignups.id, victimSignupId))
    .limit(1);
  if (!signup?.userId) return null;
  const [event] = await db
    .select({ title: schema.events.title })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return {
    userId: signup.userId,
    eventTitle: event?.title ?? `Event #${eventId}`,
  };
}
