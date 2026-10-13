/**
 * Contract tests for the Pelican config PUT (ROK-121): the API key must be
 * printable ASCII with no whitespace or control characters, because an
 * invalid Bearer header makes fetch throw an error that quotes the key.
 */
import { describe, it, expect } from 'vitest';
import { PelicanConfigUpdateSchema } from '../pelican.schema.js';

describe('PelicanConfigUpdateSchema apiKey charset', () => {
    it.each([
        ['a client key', 'pacc_AbC123xyz0987654321'],
        ['an empty string (clear)', ''],
        ['surrounding whitespace (trimmed)', '  pacc_abc123  '],
    ])('accepts %s', (_label, apiKey) => {
        expect(PelicanConfigUpdateSchema.safeParse({ apiKey }).success).toBe(
            true,
        );
    });

    it.each([
        ['an interior space', 'pacc_abc 123'],
        ['an interior CR/LF', 'pacc_abc\r\nX-Evil: 1'],
        ['a tab', 'pacc_abc\t123'],
        ['a NUL byte', 'pacc_abc\u0000123'],
        ['a non-ASCII character', 'pacc_abcé123'],
    ])('rejects %s with a fixed message', (_label, apiKey) => {
        const result = PelicanConfigUpdateSchema.safeParse({ apiKey });
        expect(result.success).toBe(false);
        expect(result.error?.issues.map((i) => i.message)).toEqual([
            'API key contains invalid characters',
        ]);
    });
});
