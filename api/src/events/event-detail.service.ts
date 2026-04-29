import { Inject, Injectable } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { EventsService } from './events.service';
import { SignupsService } from './signups.service';
import { PugsService } from './pugs.service';
import { ChannelResolverService } from '../discord-bot/services/channel-resolver.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import type { EventDetailResponseDto } from '@raid-ledger/contract';
import { enrichEventWithConflicts } from './event-conflict-enrich.helpers';
import { findConflictingEvents } from './event-conflict.helpers';
import { resolveVoiceChannelForEvent } from './voice-channel-resolver.helpers';

@Injectable()
export class EventDetailService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly eventsService: EventsService,
    private readonly signupsService: SignupsService,
    private readonly pugsService: PugsService,
    private readonly channelResolverService: ChannelResolverService,
    private readonly discordBotClientService: DiscordBotClientService,
  ) {}

  async findDetail(
    id: number,
    userId: number | null,
  ): Promise<EventDetailResponseDto> {
    const event = await this.eventsService.findOne(id);
    const isAuthenticated = userId !== null;
    const [roster, rosterAssignments, pugList, voiceChannel] =
      await Promise.all([
        this.signupsService.getRoster(id),
        this.signupsService.getRosterWithAssignments(id),
        this.pugsService.findAll(id),
        resolveVoiceChannelForEvent(
          {
            channelResolver: this.channelResolverService,
            bot: this.discordBotClientService,
          },
          event,
          isAuthenticated,
        ),
      ]);
    const enriched = await enrichEventWithConflicts(event, userId, (p) =>
      findConflictingEvents(this.db, p),
    );
    return {
      event: enriched,
      roster,
      rosterAssignments,
      pugs: pugList.pugs,
      voiceChannel,
    };
  }
}
