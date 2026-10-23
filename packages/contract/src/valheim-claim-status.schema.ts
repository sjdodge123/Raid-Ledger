import { z } from 'zod';

/**
 * `GET plugins/valheim/armory/servers/:serverId/claim-status` (ROK-1933): what the
 * hub's claim banner needs without paging the whole characters list.
 */
export const ValheimClaimStatusResponseSchema = z
  .object({
    /** The viewer has claimed at least one character on this server. */
    viewerHasClaim: z.boolean(),
    /** Characters on this server nobody has claimed. */
    unclaimedCount: z.number().int().min(0),
  })
  .strict();
export type ValheimClaimStatusResponse = z.infer<
  typeof ValheimClaimStatusResponseSchema
>;
