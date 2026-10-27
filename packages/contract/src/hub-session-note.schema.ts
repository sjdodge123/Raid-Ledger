import { z } from 'zod';
import { HUB_POST_BODY_MAX, HubPostPersonSchema } from './hub-posts.schema.js';

/**
 * ROK-1968 — "Before next session": one shared note + checklist per hub,
 * owned by the built-in Core plugin (widget `plugin:core:session-note`).
 *
 * The body is markdown source in the hub-post subset (normalised server-side);
 * the checklist is structured rows because the renderer has no task-list
 * extension. Body cap reuses `HUB_POST_BODY_MAX` (4000) — ruling 7.
 */

const id = z.number().int().positive();
const isoDate = z.iso.datetime({ offset: true });

export const HUB_SESSION_NOTE_ITEMS_MAX = 20;
export const HUB_SESSION_NOTE_ITEM_TEXT_MAX = 200;

const itemText = z.string().trim().min(1).max(HUB_SESSION_NOTE_ITEM_TEXT_MAX);

/** One checklist row. Who ticked it is stored but not exposed in v1 (ruling 8). */
export const HubSessionNoteItemSchema = z
  .object({
    id,
    text: itemText,
    done: z.boolean(),
    doneAt: isoDate.nullable(),
  })
  .strict();
export type HubSessionNoteItem = z.infer<typeof HubSessionNoteItemSchema>;

/** The event a self-clearing note is pinned to ("Clears after <title> · <when>"). */
export const HubSessionNoteClearAfterSchema = z
  .object({
    eventId: id,
    title: z.string(),
    startTime: isoDate,
    endTime: isoDate,
  })
  .strict();
export type HubSessionNoteClearAfter = z.infer<typeof HubSessionNoteClearAfterSchema>;

export const HubSessionNoteSchema = z
  .object({
    body: z.string().max(HUB_POST_BODY_MAX),
    items: z.array(HubSessionNoteItemSchema).max(HUB_SESSION_NOTE_ITEMS_MAX),
    updatedAt: isoDate,
    /** Null once the editor's account is deleted (FK SET NULL). */
    updatedBy: HubPostPersonSchema.nullable(),
    clearAfter: HubSessionNoteClearAfterSchema.nullable(),
  })
  .strict();
export type HubSessionNote = z.infer<typeof HubSessionNoteSchema>;

/** `GET /guilds/:id/session-note` (and every write's response). */
export const HubSessionNoteResponseSchema = z
  .object({
    /** Null = no note (or its pinned event has ended). */
    note: HubSessionNoteSchema.nullable(),
    viewer: z.object({ canEdit: z.boolean(), canTick: z.boolean() }).strict(),
    /** Editors only (null for members): labels or disables the clear-after toggle. */
    nextEvent: HubSessionNoteClearAfterSchema.nullable(),
  })
  .strict();
export type HubSessionNoteResponse = z.infer<typeof HubSessionNoteResponseSchema>;

/** A row in an editor save: `id` present = keep that row (and its tick); absent = new row. */
export const PutHubSessionNoteItemSchema = z
  .object({ id: id.optional(), text: itemText })
  .strict();
export type PutHubSessionNoteItem = z.infer<typeof PutHubSessionNoteItemSchema>;

/**
 * `PUT /guilds/:id/session-note`. Rows missing from `items` are deleted.
 * `baseUpdatedAt` is the `updatedAt` the editor loaded (null when creating);
 * a mismatch is a 409. A note must carry a non-blank body or at least one item.
 */
export const PutHubSessionNoteSchema = z
  .object({
    body: z.string().max(HUB_POST_BODY_MAX),
    items: z.array(PutHubSessionNoteItemSchema).max(HUB_SESSION_NOTE_ITEMS_MAX),
    clearAfterNextEvent: z.boolean(),
    baseUpdatedAt: isoDate.nullable(),
  })
  .strict()
  .refine((note) => note.body.trim().length > 0 || note.items.length > 0, {
    message: 'Add a note or at least one checklist item',
    path: ['body'],
  });
export type PutHubSessionNoteInput = z.infer<typeof PutHubSessionNoteSchema>;

/** `PATCH /guilds/:id/session-note/items/:itemId` — members may tick (ruling 1). */
export const TickHubSessionNoteItemSchema = z.object({ done: z.boolean() }).strict();
export type TickHubSessionNoteItemInput = z.infer<typeof TickHubSessionNoteItemSchema>;
