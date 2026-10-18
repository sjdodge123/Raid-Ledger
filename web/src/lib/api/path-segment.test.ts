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
        const segment = encodePathSegment('../admin/settings/oauth/clear#');
        expect(resolved(segment)).toBe('/api/things/..%2Fadmin%2Fsettings%2Foauth%2Fclear%23/read');
    });

    it.each(['', '.', '..'])('rejects the dot/empty segment %j', (value) => {
        expect(() => encodePathSegment(value)).toThrow(/path segment/i);
        expect(tryEncodePathSegment(value)).toBeNull();
    });
});
