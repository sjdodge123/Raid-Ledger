/**
 * Contract tests for the Pelican admin servers table (ROK-1094): the row is
 * strict so a leaked panel uuid fails the API's own parse, and the PATCH body
 * is partial, strict and non-empty. ROK-1795 removed the timezone concept: no
 * row carries `timezone`/`tzMismatch` and the PATCH body rejects `timezone`.
 */
import { describe, it, expect } from 'vitest';
import {
    PelicanServerListResponseSchema,
    PelicanServerRowSchema,
    PelicanServerUpdateSchema,
} from '../pelican-servers.schema.js';

const row = {
    id: 1,
    name: 'Valheim',
    state: 'running',
    isSuspended: false,
    gameId: 7,
    gameName: 'Valheim',
    showOnCalendar: true,
    lastSyncedAt: '2026-10-13T12:00:00.000Z',
    statusCheckedAt: null,
    missing: false,
    presenceTracking: false,
    presenceSupported: true,
};

describe('PelicanServerRowSchema', () => {
    it('accepts the play-day timezone (ROK-1882) but rejects the removed tzMismatch key (ROK-1795)', () => {
        expect(PelicanServerRowSchema.safeParse(row).success).toBe(true);
        expect(
            PelicanServerRowSchema.safeParse({ ...row, timezone: null }).success,
        ).toBe(true);
        expect(
            PelicanServerRowSchema.safeParse({ ...row, timezone: 'Europe/Berlin' })
                .success,
        ).toBe(true);
        expect(
            PelicanServerRowSchema.safeParse({ ...row, tzMismatch: false })
                .success,
        ).toBe(false);
    });

    it('accepts a well-formed row inside the list response', () => {
        expect(
            PelicanServerListResponseSchema.safeParse({ data: [row] }).success,
        ).toBe(true);
    });

    it.each([['panelUuid'], ['identifier'], ['node'], ['address']])(
        'rejects a leaked %s key',
        (key) => {
            const result = PelicanServerRowSchema.safeParse({
                ...row,
                [key]: 'leak',
            });
            expect(result.success).toBe(false);
        },
    );
});

describe('PelicanServerUpdateSchema', () => {
    it('rejects an empty update', () => {
        expect(PelicanServerUpdateSchema.safeParse({}).success).toBe(false);
    });

    // ROK-1882 (operator ruling 2026-10-23): `timezone` is back as the game
    // server's play-day boundary only; schedules stay UTC (ROK-1795).
    it('rejects an empty timezone (ROK-1882)', () => {
        expect(PelicanServerUpdateSchema.safeParse({ timezone: '' }).success).toBe(
            false,
        );
    });

    it.each([['America/New_York'], [null]])(
        'accepts a play-day timezone of %j (ROK-1882)',
        (timezone) => {
            expect(PelicanServerUpdateSchema.safeParse({ timezone }).success).toBe(
                true,
            );
        },
    );

    it('accepts gameId null (unmap) and showOnCalendar alone', () => {
        expect(PelicanServerUpdateSchema.safeParse({ gameId: null }).success).toBe(
            true,
        );
        expect(
            PelicanServerUpdateSchema.safeParse({ showOnCalendar: false }).success,
        ).toBe(true);
    });

    it('rejects an unknown key and a non-positive gameId', () => {
        expect(
            PelicanServerUpdateSchema.safeParse({ name: 'x', gameId: 1 }).success,
        ).toBe(false);
        expect(PelicanServerUpdateSchema.safeParse({ gameId: 0 }).success).toBe(
            false,
        );
    });
});
