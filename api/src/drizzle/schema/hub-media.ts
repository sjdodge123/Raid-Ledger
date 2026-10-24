import {
  bigserial,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { guilds } from './guilds';
import { users } from './users';

const tsz = (name: string) => timestamp(name, { withTimezone: true });

/**
 * ROK-1942: the shared hub media store behind the Gallery widget. One row
 * per picture, keyed by hub. `provenance_key` (built by the source, e.g.
 * `discord:<channel>:<message>:<attachment>`) dedupes backfill + live
 * overlap; a removed row stays as a tombstone (`removed_at`, files gone) so
 * a re-run never re-adds it. `kind` is the source kind the gallery filters
 * on (operator ruling 2026-10-24). Files live at
 * `<HUB_MEDIA_DIR>/<guild_id>/<storage_name>{,.thumb}.webp`.
 */
export const hubMedia = pgTable(
  'hub_media',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    guildId: integer('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    kind: text('kind').notNull(),
    provenanceKey: text('provenance_key').notNull(),
    discordChannelId: varchar('discord_channel_id', { length: 32 }),
    discordMessageId: varchar('discord_message_id', { length: 32 }),
    discordAttachmentId: varchar('discord_attachment_id', { length: 32 }),
    /** Parsed from the post — free text, never logged. */
    authorName: text('author_name'),
    caption: text('caption'),
    capturedAt: tsz('captured_at').notNull(),
    /** `<uuid>` with no extension — the only input to a file path. */
    storageName: text('storage_name').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    /** Full + thumb bytes, summed for the per-hub cap. */
    bytes: integer('bytes').notNull(),
    hiddenAt: tsz('hidden_at'),
    hiddenBy: integer('hidden_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    removedAt: tsz('removed_at'),
    createdAt: tsz('created_at').notNull().defaultNow(),
  },
  (t) => [
    // Leading guild_id also backs the guilds FK.
    uniqueIndex('hub_media_provenance_uq').on(t.guildId, t.provenanceKey),
    // Newest-first feed ("All") and the same feed filtered by kind (chips).
    index('hub_media_feed_idx')
      .on(t.guildId, t.capturedAt.desc(), t.id.desc())
      .where(sql`${t.removedAt} IS NULL`),
    index('hub_media_feed_kind_idx')
      .on(t.guildId, t.kind, t.capturedAt.desc(), t.id.desc())
      .where(sql`${t.removedAt} IS NULL`),
    index('hub_media_hidden_by_idx').on(t.hiddenBy),
    check('hub_media_source_check', sql`${t.source} IN ('discord')`),
    check(
      'hub_media_kind_check',
      sql`${t.kind} IN ('death', 'screenshot', 'image')`,
    ),
  ],
);

export type HubMediaRow = typeof hubMedia.$inferSelect;
