import { z } from 'zod';

/**
 * ROK-2215: invite the owners of up to five planned characters to an event.
 * Body of `POST /api/events/:id/invite-characters` (creator or staff only).
 */
export const InviteCharactersSchema = z
  .object({
    characterIds: z.array(z.string().uuid()).min(1).max(5),
  })
  .strict();
export type InviteCharactersDto = z.infer<typeof InviteCharactersSchema>;

export const InviteCharactersSkipReasonSchema = z.enum([
  'no_discord',
  'already_signed_up',
  'not_found',
  'deactivated',
]);
export type InviteCharactersSkipReason = z.infer<
  typeof InviteCharactersSkipReasonSchema
>;

/** Self-invites and a second character of the same owner produce no entry. */
export const InviteCharactersResultSchema = z
  .object({
    invited: z
      .array(
        z
          .object({
            characterId: z.string().uuid(),
            characterName: z.string().max(100),
            username: z.string(),
          })
          .strict(),
      )
      .max(5),
    skipped: z
      .array(
        z
          .object({
            characterId: z.string().uuid(),
            characterName: z.string().max(100).nullable(),
            reason: InviteCharactersSkipReasonSchema,
          })
          .strict(),
      )
      .max(5),
  })
  .strict();
export type InviteCharactersResultDto = z.infer<
  typeof InviteCharactersResultSchema
>;
