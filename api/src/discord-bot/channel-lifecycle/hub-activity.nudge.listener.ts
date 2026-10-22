import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { HUB_NOTIFICATION_EVENTS } from '../../notifications/hub-notification.constants';
import { GameActivityNudge } from './channel-lifecycle.nudge';

/** Reads `guildId` off a `hub.leader-post` payload. */
export function readHubGuildId(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null) return null;
  if (!('guildId' in payload)) return null;
  const { guildId } = payload;
  return typeof guildId === 'number' ? guildId : null;
}

/**
 * ROK-1873 (ROK-1428 §2.6 / D12, M7) — a leader post on a `game_community`
 * hub is hub activity: nudge its game's channel lifecycle. Approve and join
 * nudge from their services; posts arrive here so `HubPostsService` stays
 * untouched. Other hub kinds' posts are not lifecycle activity.
 */
@Injectable()
export class HubActivityNudgeListener {
  private readonly logger = new Logger(HubActivityNudgeListener.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly nudge: GameActivityNudge,
  ) {}

  @OnEvent(HUB_NOTIFICATION_EVENTS.LEADER_POST)
  async handleLeaderPost(payload: unknown): Promise<void> {
    try {
      const guildId = readHubGuildId(payload);
      if (guildId === null) return;
      const gameId = await this.communityGameId(guildId);
      GameActivityNudge.safeTouch(this.nudge, gameId);
    } catch (err: unknown) {
      this.logger.warn(`Hub post nudge failed: ${String(err)}`);
    }
  }

  /** The hub's game when it is a community hub, else null. */
  private async communityGameId(guildId: number): Promise<number | null> {
    const g = schema.guilds;
    const [row] = await this.db
      .select({ gameId: g.gameId })
      .from(g)
      .where(and(eq(g.id, guildId), eq(g.kind, 'game_community')))
      .limit(1);
    return row?.gameId ?? null;
  }
}
