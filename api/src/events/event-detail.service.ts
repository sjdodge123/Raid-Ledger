import { Inject, Injectable } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { EventsService } from './events.service';
import { SignupsService } from './signups.service';
import { PugsService } from './pugs.service';
import { ChannelResolverService } from '../discord-bot/services/channel-resolver.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import type {
  EventDetailResponseDto,
  PublicEventDetailResponseDto,
} from '@raid-ledger/contract';
import { enrichEventWithConflicts } from './event-conflict-enrich.helpers';
import { findConflictingEvents } from './event-conflict.helpers';
import { resolveVoiceChannelForEvent } from './voice-channel-resolver.helpers';
import {
  isMemberViewer,
  projectEventDetailForViewer,
} from './roster-public-projection.helpers';

/** The caller as OptionalJwtGuard leaves it: null for anonymous. */
export type DetailViewer = {
  id: number;
  deactivatedAt?: Date | string | null;
} | null;

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

  /**
   * ROK-1629: the bundle embeds the roster + assignments, so it carries the
   * same per-viewer projection as the standalone routes (deactivated = anon).
   * A deactivated viewer is built as anonymous too, so the PUG, voice and
   * conflict branches never see their id.
   */
  async findDetail(
    id: number,
    viewer: DetailViewer,
  ): Promise<EventDetailResponseDto | PublicEventDetailResponseDto> {
    const isMember = isMemberViewer(viewer);
    const memberId = isMember && viewer ? viewer.id : null;
    const detail = await this.buildDetail(id, memberId);
    return projectEventDetailForViewer(detail, isMember);
  }

  /** The full member-shape bundle; never returned to a caller unprojected. */
  private async buildDetail(
    id: number,
    userId: number | null,
  ): Promise<EventDetailResponseDto> {
    const event = await this.eventsService.findOne(id);
    const isAuthenticated = userId !== null;
    // ROK-1189: the conflict enrichment only needs the event + userId, both of
    // which are in hand here, so it joins the parallel batch instead of adding
    // a serial round-trip after it.
    const [roster, rosterAssignments, pugList, voiceChannel, enriched] =
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
        enrichEventWithConflicts(event, userId, (p) =>
          findConflictingEvents(this.db, p),
        ),
      ]);
    return {
      event: enriched,
      roster,
      rosterAssignments,
      pugs: pugList.pugs,
      voiceChannel,
    };
  }
}
