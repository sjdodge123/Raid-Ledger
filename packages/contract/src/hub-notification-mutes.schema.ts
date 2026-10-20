import { z } from 'zod';
import { GuildKindSchema } from './guilds.schema.js';

/**
 * ROK-1832: per-group notification mute ("bell off") for guild and community
 * hubs — independent of the per-game mute (ROK-1797). A muted group sends the
 * viewer no leader-post or event-tagged notice (in-app or Discord DM). Not
 * part of the LedgerLink wire format (`ledgerlink/v1/`).
 */

/** POST/DELETE /guilds/:id/notification-mute response. */
export const HubNotificationMuteResponseSchema = z
    .object({
        guildId: z.number().int().positive(),
        muted: z.boolean(),
    })
    .strict();

export type HubNotificationMuteResponseDto = z.infer<
    typeof HubNotificationMuteResponseSchema
>;

/** One muted group in the viewer's list. */
export const HubNotificationMuteItemSchema = z
    .object({
        guildId: z.number().int().positive(),
        name: z.string(),
        kind: GuildKindSchema,
        gameName: z.string().nullable(),
        /** ISO timestamp the mute was created. */
        mutedAt: z.string(),
    })
    .strict();

export type HubNotificationMuteItemDto = z.infer<
    typeof HubNotificationMuteItemSchema
>;

/** GET /notifications/hub-mutes response, ordered by group name. */
export const HubNotificationMuteListSchema = z
    .object({
        data: z.array(HubNotificationMuteItemSchema),
    })
    .strict();

export type HubNotificationMuteListDto = z.infer<
    typeof HubNotificationMuteListSchema
>;
