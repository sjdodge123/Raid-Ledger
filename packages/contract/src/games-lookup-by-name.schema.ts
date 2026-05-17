import { z } from 'zod';

/**
 * Input for POST /games/lookup-by-name (ROK-1295).
 * Free-text name → name-dedup → ITAD → IGDB cascade, returns a hydrated GameDetailDto.
 */
export const LookupGameByNameInputSchema = z.object({
    q: z.string().min(1).max(200),
});

export type LookupGameByNameInputDto = z.infer<typeof LookupGameByNameInputSchema>;
