import { Inject, Injectable, Logger } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { SettingsService } from '../../settings/settings.service';
import { EphemeralVoiceIdleQueueService } from '../queues/ephemeral-voice-idle.queue';
import {
  findEventByEphemeralChannel,
  type EphemeralEventRow,
} from './ephemeral-voice.db-helpers';
import { getChannelMemberCount } from './ephemeral-voice.discord-ops';

/**
 * Bridges voice-state leave/join events to the ephemeral idle-delete queue
 * (ROK-1352). Kept separate from the listener so the listener stays under the
 * 300-line cap and the enqueue/cancel decision logic is unit-testable.
 */
@Injectable()
export class EphemeralVoiceIdleCoordinator {
  private readonly logger = new Logger(EphemeralVoiceIdleCoordinator.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly settingsService: SettingsService,
    private readonly idleQueue: EphemeralVoiceIdleQueueService,
  ) {}

  /** Member left `channelId`: if it's an ephemeral channel now empty + past end,
   *  schedule an idle-delete after `idleMinutes`. */
  async onChannelLeave(channelId: string): Promise<void> {
    // Hot path: skip the DB lookup entirely when the feature is off (the default).
    // getEphemeralVoiceEnabled is a cached in-memory settings read, not a query.
    if (!(await this.settingsService.getEphemeralVoiceEnabled())) return;
    const ev = await findEventByEphemeralChannel(this.db, channelId);
    if (!ev || !this.isPastEnd(ev)) return;
    if (this.channelStillOccupied(channelId)) return;
    const idleMin = await this.settingsService.getEphemeralVoiceIdleMinutes();
    await this.idleQueue.enqueue(
      { eventId: ev.id, channelId },
      idleMin * 60_000,
    );
  }

  /** Member joined `channelId`: cancel any pending idle-delete for it. */
  async onChannelJoin(channelId: string): Promise<void> {
    if (!(await this.settingsService.getEphemeralVoiceEnabled())) return;
    const ev = await findEventByEphemeralChannel(this.db, channelId);
    if (ev) await this.idleQueue.cancel(ev.id);
  }

  private isPastEnd(ev: EphemeralEventRow): boolean {
    return new Date(ev.endTime).getTime() <= Date.now();
  }

  private channelStillOccupied(channelId: string): boolean {
    const guild = this.clientService.getGuild();
    if (!guild) return false;
    return getChannelMemberCount(guild, channelId) > 0;
  }
}
