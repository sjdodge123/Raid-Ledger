/**
 * Contract tests for the Pelican admin servers table (ROK-1094): the row is
 * strict so a leaked panel uuid fails the API's own parse, and the PATCH body
 * is partial, strict, non-empty, with `timezone: ''` meaning "inherit".
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
    timezone: null,
    lastSyncedAt: '2026-10-13T12:00:00.000Z',
    statusCheckedAt: null,
    missing: false,
    tzMismatch: false,
};

describe('PelicanServerRowSchema', () => {
    it('requires the ROK-1096 tzMismatch flag', () => {
        const { tzMismatch: _omit, ...withoutFlag } = row;
        expect(PelicanServerRowSchema.safeParse(withoutFlag).success).toBe(
            false,
        );
        expect(
            PelicanServerRowSchema.safeParse({ ...row, tzMismatch: true })
                .success,
        ).toBe(true);
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

    it('rejects an unknown timezone', () => {
        expect(
            PelicanServerUpdateSchema.safeParse({ timezone: 'Mars/Olympus' })
                .success,
        ).toBe(false);
    });

    it.each([[''], ['America/New_York'], ['  Europe/Berlin  ']])(
        'accepts timezone %j',
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
