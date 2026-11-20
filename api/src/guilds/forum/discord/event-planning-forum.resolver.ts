/**
 * ROK-2272 §3.2 — which Discord forum a NON-hub subject (event, scheduling
 * poll, lineup) posts into. Hub subjects keep using their hub's binding.
 * 0 bound forums ⇒ none; 1 ⇒ it; ≥2 ⇒ the admin's pick (setting
 * `discord_bot_event_planning_forum`) while it is still bound, else R3: the
 * one bot-managed forum named `event-planning`, else none + a warning.
 */
import { Inject, Injectable } from '@nestjs/common';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import { SETTING_KEYS } from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import {
  loadBoundForums,
  type BoundForum,
} from './event-planning-forum.queries';
import { HubForumDiscordGateway } from './hub-forum-discord.gateway';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

/** The R3 fallback's channel name (the renamed shared forum, §3.4). */
export const EVENT_PLANNING_FORUM_NAME = 'event-planning';

/** ≥2 bound forums, no valid pick and no single managed `event-planning`. */
export const EVENT_PLANNING_FORUM_AMBIGUOUS = 'ambiguous';
export type EventPlanningForumWarning = typeof EVENT_PLANNING_FORUM_AMBIGUOUS;

/** The resolver's answer (S5's admin card reads all three). */
export interface EventPlanningResolution {
  forum: BoundForum | null;
  candidates: BoundForum[];
  warning: EventPlanningForumWarning | null;
}

/** What the rule needs besides the candidates. */
export interface EventPlanningInputs {
  /** Setting `discord_bot_event_planning_forum`; null when unset. */
  pickedChannelId: string | null;
  /** The live Discord channel name, or null when unknown. */
  nameOf: (channelId: string) => string | null;
}

/**
 * §3.2 steps 2–4 on plain data (no I/O).
 *
 * @param candidates - The guild's bound forums.
 * @param inputs - The stored pick and a channel-name lookup.
 */
export function pickEventPlanningForum(
  candidates: readonly BoundForum[],
  inputs: EventPlanningInputs,
): Omit<EventPlanningResolution, 'candidates'> {
  if (candidates.length <= 1) {
    return { forum: candidates[0] ?? null, warning: null };
  }
  const picked = candidates.find((c) => c.channelId === inputs.pickedChannelId);
  if (picked) return { forum: picked, warning: null };
  const named = candidates.filter(
    (c) =>
      c.managed && inputs.nameOf(c.channelId) === EVENT_PLANNING_FORUM_NAME,
  );
  const only = named.length === 1 ? (named[0] ?? null) : null;
  return only
    ? { forum: only, warning: null }
    : { forum: null, warning: EVENT_PLANNING_FORUM_AMBIGUOUS };
}

/**
 * §3.2 against the database: the Discord guild's bound forums, then
 * {@link pickEventPlanningForum}.
 *
 * @param db - Drizzle handle.
 * @param discordGuildId - The Discord guild (server) snowflake.
 * @param inputs - The stored pick and a channel-name lookup.
 */
export async function resolveEventPlanningForum(
  db: ForumDiscordDb,
  discordGuildId: string,
  inputs: EventPlanningInputs,
): Promise<EventPlanningResolution> {
  const candidates = await loadBoundForums(db, discordGuildId);
  return { ...pickEventPlanningForum(candidates, inputs), candidates };
}

/**
 * {@link resolveEventPlanningForum} cached per Discord guild for 60 s (like
 * `HubForumDiscordRouteResolver`). Call {@link invalidate} on hub bind/unbind
 * and whenever the setting changes.
 */
@Injectable()
export class EventPlanningForumResolver {
  static readonly TTL_MS = 60_000;
  private readonly cache = new Map<
    string,
    { at: number; value: EventPlanningResolution }
  >();

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    private readonly settings: SettingsService,
    private readonly gateway: HubForumDiscordGateway,
  ) {}

  /** The forum non-hub subjects of `discordGuildId` post into. */
  async resolve(
    discordGuildId: string,
    now = Date.now(),
  ): Promise<EventPlanningResolution> {
    const hit = this.cache.get(discordGuildId);
    if (hit && now - hit.at < EventPlanningForumResolver.TTL_MS) {
      return hit.value;
    }
    const value = await resolveEventPlanningForum(this.db, discordGuildId, {
      pickedChannelId: await this.settings.get(
        SETTING_KEYS.DISCORD_BOT_EVENT_PLANNING_FORUM,
      ),
      nameOf: (id) => this.gateway.cachedForum(id)?.name ?? null,
    });
    this.cache.set(discordGuildId, { at: now, value });
    return value;
  }

  /** Forget everything (bind/unbind, setting change, tests). */
  invalidate(): void {
    this.cache.clear();
  }
}
