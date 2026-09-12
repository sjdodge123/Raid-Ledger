/**
 * Failing-first contract tests for ROK-1309 S1 — the cohort-memory DTO.
 *
 * Covers the AC "Contract: `CohortMemoryResponseDto` Zod schema published
 * from `packages/contract`" plus the AC that `veto_lost` rows are filtered
 * out at the API layer for the lineup endpoint: the surfaced entry schema
 * deliberately narrows the canonical resolution enum to the three positive
 * outcomes, so a `veto_lost` payload is a contract violation rather than a
 * row the UI has to remember to hide.
 */
import { describe, it, expect } from 'vitest';
import {
    CohortMemoryResolutionSchema,
    CohortMemoryEntrySchema,
    CohortMemoryResponseSchema,
    type CohortMemoryResponseDto,
} from '../lineup-cohort-memory.schema.js';

/** Minimal valid response payload. */
function baseResponse(): CohortMemoryResponseDto {
    return {
        cohortSize: 3,
        entries: [
            {
                gameId: 42,
                gameName: 'Valheim',
                gameCoverUrl: null,
                resolution: 'decided',
                lastResolvedAt: '2026-05-17T20:45:55.710Z',
                sourceLineupId: 7,
            },
        ],
    };
}

describe('CohortMemoryResponseDto (ROK-1309)', () => {
    it('parses a valid payload', () => {
        const parsed = CohortMemoryResponseSchema.parse(baseResponse());
        expect(parsed.cohortSize).toBe(3);
        expect(parsed.entries[0].resolution).toBe('decided');
    });

    it('accepts an empty entries array (no cohort match)', () => {
        expect(
            CohortMemoryResponseSchema.parse({ cohortSize: 0, entries: [] })
                .entries,
        ).toEqual([]);
    });

    it('rejects an unknown resolution value', () => {
        const payload = baseResponse();
        const bad = {
            ...payload,
            entries: [{ ...payload.entries[0], resolution: 'exploded' }],
        };
        const result = CohortMemoryResponseSchema.safeParse(bad);
        expect(result.success).toBe(false);
    });

    it('rejects veto_lost on a surfaced entry (filtered at the API layer)', () => {
        const payload = baseResponse();
        const result = CohortMemoryEntrySchema.safeParse({
            ...payload.entries[0],
            resolution: 'veto_lost',
        });
        expect(result.success).toBe(false);
    });

    it('keeps veto_lost in the canonical resolution enum (ROK-1310 reads it)', () => {
        expect(CohortMemoryResolutionSchema.options).toEqual([
            'decided',
            'match',
            'veto_won',
            'veto_lost',
        ]);
    });
});
