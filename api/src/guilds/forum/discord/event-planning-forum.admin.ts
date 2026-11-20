/**
 * ROK-2272 S5a — the admin "Event planning forum" setting behind
 * `GET/PUT /admin/discord/event-planning-forum` (§3.2, §4.3). GET reports the
 * stored pick, the bound forums of the bot's Discord guild and what the
 * resolver picks right now; PUT stores a pick that must be a current
 * candidate (null clears it) and invalidates the resolver cache.
 */
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  UpdateEventPlanningForumSchema,
  type EventPlanningForumCandidate,
  type EventPlanningForumSettingsDto,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import { SETTING_KEYS } from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { loadBoundForums } from './event-planning-forum.queries';
import {
  EVENT_PLANNING_FORUM_UNKNOWN,
  EventPlanningForumResolver,
  type EventPlanningResolution,
} from './event-planning-forum.resolver';
import { HubForumDiscordGateway } from './hub-forum-discord.gateway';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

const KEY = SETTING_KEYS.DISCORD_BOT_EVENT_PLANNING_FORUM;

/**
 * The admin DTO from a resolution (no I/O). A channel whose name the bot
 * cannot read is labelled with its id so the card still lists it.
 *
 * @param picked - The stored setting; null when unset.
 * @param resolution - The resolver's answer for the bot's Discord guild.
 * @param nameOf - Live channel name; null/undefined when unreadable.
 */
export function toEventPlanningForumSettings(
  picked: string | null,
  resolution: EventPlanningResolution,
  nameOf: (channelId: string) => string | null | undefined,
): EventPlanningForumSettingsDto {
  const candidates: EventPlanningForumCandidate[] = resolution.candidates.map(
    (c) => ({
      channelId: c.channelId,
      name: nameOf(c.channelId) ?? c.channelId,
      managed: c.managed,
    }),
  );
  return {
    channelId: picked,
    candidates,
    resolvedChannelId: resolution.forum?.channelId ?? null,
    ...(resolution.warning ? { warning: resolution.warning } : {}),
  };
}

/** Reads and writes the event-planning forum pick for the admin card. */
@Injectable()
export class EventPlanningForumAdmin {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    private readonly settings: SettingsService,
    private readonly gateway: HubForumDiscordGateway,
    private readonly resolver: EventPlanningForumResolver,
  ) {}

  /**
   * The admin DTO. Bot offline ⇒ the Discord guild is unknown: no
   * candidates and the `'unknown'` warning (names unavailable).
   */
  async read(): Promise<EventPlanningForumSettingsDto> {
    const picked = await this.settings.get(KEY);
    const discordGuildId = this.gateway.guildId();
    if (discordGuildId === null) {
      return {
        channelId: picked,
        candidates: [],
        resolvedChannelId: null,
        warning: EVENT_PLANNING_FORUM_UNKNOWN,
      };
    }
    const resolution = await this.resolver.resolve(discordGuildId);
    return toEventPlanningForumSettings(
      picked,
      resolution,
      (id) => this.gateway.cachedForum(id)?.name,
    );
  }

  /**
   * Store (or clear, on null) the pick, then invalidate the resolver.
   *
   * @param body - `{ channelId: string | null }`; anything else is a 400.
   * @throws BadRequestException on a malformed body or a non-candidate.
   */
  async update(body: unknown): Promise<EventPlanningForumSettingsDto> {
    const parsed = UpdateEventPlanningForumSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Invalid event planning forum request');
    }
    const { channelId } = parsed.data;
    if (channelId === null) {
      await this.settings.delete(KEY);
    } else {
      await this.assertCandidate(channelId);
      await this.settings.set(KEY, channelId);
    }
    this.resolver.invalidate();
    return this.read();
  }

  /** 400 unless `channelId` is a bound forum of the bot's Discord guild. */
  private async assertCandidate(channelId: string): Promise<void> {
    const discordGuildId = this.gateway.guildId();
    const candidates =
      discordGuildId === null
        ? []
        : await loadBoundForums(this.db, discordGuildId);
    if (!candidates.some((c) => c.channelId === channelId)) {
      throw new BadRequestException(
        'That channel is not a forum a hub is bound to',
      );
    }
  }
}
