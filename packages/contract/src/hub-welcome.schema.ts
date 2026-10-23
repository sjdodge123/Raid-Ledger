import { z } from 'zod';

/**
 * `POST guilds/:id/discord/welcome` (ROK-1933): the hub's welcome embed in its
 * linked Discord channel was posted fresh or edited in place.
 */
export const HubWelcomeResultSchema = z
  .object({
    result: z.enum(['posted', 'edited']),
    pinned: z.boolean(),
    /** Non-fatal problem to show inline (e.g. the bot could not pin). */
    warning: z.string().nullable(),
  })
  .strict();
export type HubWelcomeResult = z.infer<typeof HubWelcomeResultSchema>;
