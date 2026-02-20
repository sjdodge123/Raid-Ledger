import { z } from 'zod';

/** Response from POST /auth/exchange-code and POST /auth/login */
export const TokenResponseSchema = z.object({
    access_token: z.string().min(1),
});

export type TokenResponseDto = z.infer<typeof TokenResponseSchema>;
