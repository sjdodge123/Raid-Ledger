import type { Logger } from '@nestjs/common';
import type { NotificationService } from '../../../../notifications/notification.service';

/**
 * ROK-2128 (FLAG 7) — in-app notices for admin ownership fixes, on the
 * existing `system` type (no migration). Sent AFTER the tx commits and never
 * throw: a failed notice must not turn a committed fix into a 500.
 */
export interface OwnerNotice {
  userId: number;
  title: string;
  message: string;
  characterId: string;
}

/** Old owner side of a Change owner. */
export const movedNotice = (
  userId: number,
  name: string,
  toName: string,
  characterId: string,
): OwnerNotice => ({
  userId,
  title: 'Character moved',
  message: `An admin moved ${name} to ${toName}.`,
  characterId,
});

/** New owner side of a Change owner. */
export const gainedNotice = (
  userId: number,
  name: string,
  characterId: string,
): OwnerNotice => ({
  userId,
  title: 'Character added',
  message: `An admin gave you ${name}.`,
  characterId,
});

/** Owner side of an admin unlink. */
export const removedNotice = (
  userId: number,
  name: string,
  characterId: string,
): OwnerNotice => ({
  userId,
  title: 'Character removed',
  message: `An admin removed ${name} from your characters.`,
  characterId,
});

/** Send each notice best-effort (warn on failure, never throw). */
export async function sendOwnerNotices(
  notifications: NotificationService,
  notices: OwnerNotice[],
  logger: Logger,
): Promise<void> {
  for (const n of notices) {
    try {
      await notifications.create({
        userId: n.userId,
        type: 'system',
        title: n.title,
        message: n.message,
        payload: { characterId: n.characterId },
      });
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn(`Owner notice to user ${n.userId} failed: ${reason}`);
    }
  }
}
