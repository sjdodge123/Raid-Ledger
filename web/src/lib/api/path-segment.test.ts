/**
 * ROK-1845 — the shared path-segment encoder. A decoded route/query value must
 * never change which API path a request resolves to.
 */
import { describe, it, expect } from 'vitest';
import { encodePathSegment, tryEncodePathSegment } from './path-segment';

const resolved = (segment: string) =>
    new URL(`http://api.test/api/things/${segment}/read`).pathname;

describe('encodePathSegment (ROK-1845)', () => {
    it('leaves an ordinary id unchanged', () => {
        expect(encodePathSegment('abc12345')).toBe('abc12345');
    });

    it('keeps a hostile value inside its own segment', () => {
        const segment = encodePathSegment('..?x=1#frag');
        expect(resolved(segment)).toBe('/api/things/..%3Fx%3D1%23frag/read');
    });

    // nginx decodes %2F and collapses `..` before proxying, so a separator is
    // refused rather than encoded.
    it.each(['../admin/settings', '..\\..\\admin', 'a/b', 'a\\b', '/'])(
        'rejects a value holding a path separator %j',
        (value) => {
            expect(() => encodePathSegment(value)).toThrow(/path segment/i);
            expect(tryEncodePathSegment(value)).toBeNull();
        },
    );

    it('double-encodes a literal %2F, so nginx decodes it back to text, not a slash', () => {
        expect(encodePathSegment('..%2Fadmin')).toBe('..%252Fadmin');
    });

    it.each(['', '.', '..'])('rejects the dot/empty segment %j', (value) => {
        expect(() => encodePathSegment(value)).toThrow(/path segment/i);
        expect(tryEncodePathSegment(value)).toBeNull();
    });
});
