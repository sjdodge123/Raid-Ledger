import type { GameRegistryDto } from '@raid-ledger/contract';

/** Definition for a single onboarding wizard step */
export interface StepDef {
    /** Unique key — 'character-gameId-0', 'character-gameId-1', etc. for dynamic character steps */
    key: string;
    label: string;
    /** For character steps, the registry game to pre-fill */
    registryGame?: GameRegistryDto;
    /** For character steps, which character slot this step represents (0-based) */
    charIndex?: number;
}
