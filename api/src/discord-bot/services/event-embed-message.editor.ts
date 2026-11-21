/**
 * ROK-2292 D4 — the one seam that edits a tracked event embed message.
 *
 * An event's signup card lives in two kinds of `discord_event_messages` row
 * (see `event-message-rows.helpers.ts`):
 *
 * - **announcement** rows → the bot edit, exactly as before;
 * - **forum starter** rows → the {@link ForumStarterEditPort}, implemented by
 *   the forum module. A hub forum post's starter is webhook-authored, and the
 *   bot cannot edit another author's message (50005), so the port picks the
 *   author. Resolved lazily through `ModuleRef` because the forum module
 *   imports this one (no DI cycle).
 *
 * A starter edit sends the embed + buttons with content `''` and never the
 * card's push line `built.content` (D5, ruling 1). A starter the bot can no
 * longer edit — another author (50005), a locked/archived post (50083) or a
 * deleted post (10003) — is `'gone'` and its row is deleted, so the sync job
 * stops retrying it (D7).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  DiscordAPIError,
  type ActionRowBuilder,
  type ButtonBuilder,
  type EmbedBuilder,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { embedComponents, type EmbedResult } from './discord-embed.factory';
import { isForumStarterRow } from './event-message-rows.helpers';

/** The card a forum post's starter message is edited to (content `''`). */
export interface ForumStarterCard {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
}

/** Edits a forum post's starter message; bound by the forum module. */
export interface ForumStarterEditPort {
  /**
   * Edit the starter of post `threadId` to `card`, content `''`.
   *
   * @returns `'gone'` when the post or its starter no longer exists.
   * @throws The Discord error for any other failure.
   */
  editStarter(
    threadId: string,
    card: ForumStarterCard,
  ): Promise<'edited' | 'gone'>;
}

/** DI token of the {@link ForumStarterEditPort} implementation. */
export const FORUM_STARTER_EDIT_PORT = 'FORUM_STARTER_EDIT_PORT';

/** Cannot edit another author's message, thread archived/locked, unknown channel. */
const STARTER_GONE_CODES: ReadonlySet<number | string> = new Set([
  50005, 50083, 10003,
]);

/** True when a starter edit failed in a way no retry can fix (D7). */
export function isStarterGoneError(err: unknown): boolean {
  return err instanceof DiscordAPIError && STARTER_GONE_CODES.has(err.code);
}

/** The tracked row being edited. */
export type EditableEventMessage = Pick<
  typeof schema.discordEventMessages.$inferSelect,
  'id' | 'channelId' | 'messageId'
>;

/** The built card (any factory builder's result). */
export type EditableEmbed = Pick<
  EmbedResult,
  'embed' | 'row' | 'seriesRow' | 'content'
>;

/** `withContent`: announcement edits also send `built.content` (embed sync). */
export interface EventEmbedEditOptions {
  withContent?: boolean;
}

/** `gone`: a starter row that can no longer be edited (row deleted). */
export type EventEmbedEditResult = 'edited' | 'gone';

@Injectable()
export class EventEmbedMessageEditor {
  private readonly logger = new Logger(EventEmbedMessageEditor.name);
  private port: ForumStarterEditPort | null = null;

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * Edit one tracked message to `built`. An announcement failure throws as
   * before (callers classify it); a starter failure other than D7 throws too.
   */
  async edit(
    row: EditableEventMessage,
    built: EditableEmbed,
    options: EventEmbedEditOptions = {},
  ): Promise<EventEmbedEditResult> {
    if (isForumStarterRow(row)) return this.editStarter(row, built);
    await this.editAnnouncement(row, built, options);
    return 'edited';
  }

  private async editAnnouncement(
    row: EditableEventMessage,
    built: EditableEmbed,
    options: EventEmbedEditOptions,
  ): Promise<void> {
    const rows = embedComponents(built);
    const { channelId, messageId } = row;
    if (options.withContent) {
      const { content } = built;
      await this.clientService.editEmbed(
        channelId,
        messageId,
        built.embed,
        rows,
        content,
      );
      return;
    }
    await this.clientService.editEmbed(channelId, messageId, built.embed, rows);
  }

  private async editStarter(
    row: EditableEventMessage,
    built: EditableEmbed,
  ): Promise<EventEmbedEditResult> {
    const card = { embeds: [built.embed], components: embedComponents(built) };
    try {
      const result = await this.starterPort().editStarter(row.channelId, card);
      if (result === 'edited') return 'edited';
    } catch (err) {
      if (!isStarterGoneError(err)) throw err;
    }
    await this.forget(row);
    return 'gone';
  }

  /** D7: stop tracking a starter that can no longer be edited. */
  private async forget(row: EditableEventMessage): Promise<void> {
    await this.db
      .delete(schema.discordEventMessages)
      .where(eq(schema.discordEventMessages.id, row.id));
    this.logger.log(
      `Forum post ${row.channelId} can no longer be edited; stopped syncing it`,
    );
  }

  private starterPort(): ForumStarterEditPort {
    this.port ??= this.moduleRef.get<ForumStarterEditPort>(
      FORUM_STARTER_EDIT_PORT,
      { strict: false },
    );
    return this.port;
  }
}
