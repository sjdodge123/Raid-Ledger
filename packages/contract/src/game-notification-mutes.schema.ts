import { z } from 'zod';

/**
 * ROK-1797: per-game notification mute ("bell off") — independent of the
 * heart. A muted game sends the viewer no per-game broadcast (in-app, push
 * or Discord DM). Not part of the LedgerLink wire format (`ledgerlink/v1/`).
 */

/** POST/DELETE /games/:id/notification-mute response. */
export const GameNotificationMuteResponseSchema = z.object({
    gameId: z.number().int().positive(),
    muted: z.boolean(),
});

export type GameNotificationMuteResponseDto = z.infer<
    typeof GameNotificationMuteResponseSchema
>;

/** One muted game in the viewer's list. */
export const GameNotificationMuteItemSchema = z.object({
    gameId: z.number().int().positive(),
    name: z.string(),
    slug: z.string(),
    coverUrl: z.string().nullable(),
    /** ISO timestamp the mute was created. */
    mutedAt: z.string(),
});

export type GameNotificationMuteItemDto = z.infer<
    typeof GameNotificationMuteItemSchema
>;

/** GET /notifications/game-mutes response, ordered by game name. */
export const GameNotificationMuteListSchema = z.object({
    data: z.array(GameNotificationMuteItemSchema),
});

export type GameNotificationMuteListDto = z.infer<
    typeof GameNotificationMuteListSchema
>;
