/**
 * Service to nudge unlinked Steam members during lineup building (ROK-993).
 * Sends Discord DM nudges to lineup members who have Discord but no Steam linked.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { NotificationService } from '../notifications/notification.service';
import { NotificationDedupService } from '../notifications/notification-dedup.service';
import { SettingsService } from '../settings/settings.service';

/** Shape of a member row from the nudge query. */
interface NudgeMember {
  id: number;
  discordId: string | null;
  steamId: string | null;
  displayName: string;
}

@Injectable()
export class LineupSteamNudgeService {
  private readonly logger = new Logger(LineupSteamNudgeService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly notificationService: NotificationService,
    private readonly dedupService: NotificationDedupService,
    private readonly settingsService: SettingsService,
  ) {}

  /** Send nudge DMs to members without Steam linked. */
  async nudgeUnlinkedMembers(lineupId: number): Promise<void> {
    const [clientUrl, members] = await Promise.all([
      this.settingsService.getClientUrl(),
      this.db.execute(sql`
        SELECT u.id, u.discord_id AS "discordId", u.steam_id AS "steamId",
               COALESCE(u.display_name, u.username) AS "displayName"
        FROM users u
      `) as Promise<unknown> as Promise<NudgeMember[]>,
    ]);

    for (const member of members) {
      if (!member.discordId || member.steamId) continue;
      await this.sendNudge(member, lineupId, clientUrl);
    }
  }

  /** Send a single nudge, skipping if already sent. */
  private async sendNudge(
    member: NudgeMember,
    lineupId: number,
    clientUrl: string,
  ): Promise<void> {
    const dedupKey = `lineup-steam-nudge:${lineupId}:${member.id}`;
    const alreadySent = await this.dedupService.checkAndMarkSent(
      dedupKey,
      null,
    );
    if (alreadySent) return;

    await this.notificationService.create({
      userId: member.id,
      type: 'lineup_steam_nudge',
      title: 'Link your Steam account',
      message:
        'A new community lineup is being built! Link your Steam account so we can include your library in game suggestions.',
      payload: { lineupId },
    });
  }
}
