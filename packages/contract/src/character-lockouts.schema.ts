import { z } from 'zod';

// ==========================================
// Character saved instances (ROK-1743)
// ==========================================

/**
 * One saved-instance lockout as DISPLAYED on the character page. Built at
 * read time from the LedgerLink `char` snapshot (never persisted on
 * `characters`); expired lockouts are dropped server-side.
 */
export const CharacterLockoutSchema = z.object({
    name: z.string().max(128),
    instanceId: z.number().int(),
    difficultyId: z.number().int(),
    /** Human label for `difficultyId`; null when the id is not mapped. */
    difficulty: z.string().max(32).nullable(),
    resetAt: z.string().datetime(),
    killed: z.number().int(),
    total: z.number().int(),
});

export type CharacterLockoutDto = z.infer<typeof CharacterLockoutSchema>;

/** The character's unexpired saved instances (WoW: Forever, addon-sourced). */
export const CharacterLockoutsSchema = z.object({
    source: z.literal('addon'),
    /** The snapshot's in-game capture time. */
    syncedAt: z.string().datetime(),
    instances: z.array(CharacterLockoutSchema).max(100),
});

export type CharacterLockoutsDto = z.infer<typeof CharacterLockoutsSchema>;
