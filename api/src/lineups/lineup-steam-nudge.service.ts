/**
 * Service to nudge unlinked Steam members during lineup building (ROK-993).
 * Sends Discord DM nudges to all community members who have Discord but no Steam linked.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { NotificationService } from '../notifications/notification.service';
import { NotificationDedupService } from '../notifications/notification-dedup.service';

/** Shape of an eligible nudge recipient. */
interface NudgeRecipient {
  id: number;
  displayName: string;
}

const BATCH_SIZE = 10;

@Injectable()
export class LineupSteamNudgeService {
  private readonly logger = new Logger(LineupSteamNudgeService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly notificationService: NotificationService,
    private readonly dedupService: NotificationDedupService,
  ) {}

  /** Send nudge DMs to all community members with Discord but no Steam. */
  async nudgeUnlinkedMembers(lineupId: number): Promise<void> {
    const recipients = await this.findNudgeRecipients();
    if (!recipients.length) return;

    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      const batch = recipients.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(batch.map((r) => this.sendNudge(r, lineupId)));
    }
  }

  /** Find users with Discord linked but no Steam. */
  private async findNudgeRecipients(): Promise<NudgeRecipient[]> {
    return (await this.db.execute(sql`
      SELECT u.id, COALESCE(u.display_name, u.username) AS "displayName"
      FROM users u
      WHERE u.discord_id IS NOT NULL AND u.steam_id IS NULL
    `)) as unknown as NudgeRecipient[];
  }

  /** Send a single nudge, skipping if already sent. */
  private async sendNudge(
    recipient: NudgeRecipient,
    lineupId: number,
  ): Promise<void> {
    const dedupKey = `lineup-steam-nudge:${lineupId}:${recipient.id}`;
    const alreadySent = await this.dedupService.checkAndMarkSent(
      dedupKey,
      null,
    );
    if (alreadySent) return;

    await this.notificationService.create({
      userId: recipient.id,
      type: 'lineup_steam_nudge',
      title: 'Link your Steam account',
      message:
        'A new community lineup is being built! Link your Steam account so we can include your library in game suggestions.',
      payload: { lineupId },
    });
  }
}
