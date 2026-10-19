import { z } from 'zod';
import { AdHocStatusEnum } from './ad-hoc-events.schema.js';

/**
 * ROK-1831: game-server community hub payloads (`kind = 'game_server'`),
 * served by the Pelican plugin under `/plugins/pelican/hubs/:id`.
 * Not part of the LedgerLink or valheim-link wire formats.
 */

const id = z.number().int().positive();
const isoDate = z.iso.datetime({ offset: true });

/** `POST|DELETE …/hubs/:id/join` — the viewer's manual membership after the call. */
export const HubJoinResponseSchema = z.object({ joined: z.boolean() }).strict();
export type HubJoinResponse = z.infer<typeof HubJoinResponseSchema>;

/** One Quick Play session (ad-hoc event) detected on the hub's server. */
export const HubQuickPlayItemSchema = z
  .object({
    eventId: id,
    startedAt: isoDate,
    /** null while the session is still live. */
    endedAt: isoDate.nullable(),
    status: AdHocStatusEnum,
    participantCount: z.number().int().nonnegative(),
  })
  .strict();
export type HubQuickPlayItem = z.infer<typeof HubQuickPlayItemSchema>;

/** `GET …/hubs/:id/quick-play` — newest session first. */
export const HubQuickPlayListSchema = z
  .object({ data: z.array(HubQuickPlayItemSchema) })
  .strict();
export type HubQuickPlayList = z.infer<typeof HubQuickPlayListSchema>;

/** `PATCH guilds/:id/hidden` (admin only) — sets or clears `guilds.hidden_at`. */
export const HubHideSchema = z.object({ hidden: z.boolean() }).strict();
export type HubHideInput = z.infer<typeof HubHideSchema>;
