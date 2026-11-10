/** ROK-2153 S3b — failed-claim banner mapping (review r1 MINOR 5b). */
import { describe, expect, it } from 'vitest';
import { withErrorBody, withHttpStatus } from '../../../lib/api/api-error';
import { hubClaimErrorView } from './hub-claim-copy';

function httpError(status: number, code?: string): Error {
    const e = withHttpStatus(new Error('request failed'), status);
    return code === undefined ? e : withErrorBody(e, { statusCode: status, code, message: code });
}

describe('hubClaimErrorView', () => {
    it.each([
        ['HUB_CLAIM_CANDIDATE_TAKEN', 409, 'Someone else just claimed that character. Pick another.'],
        ['HUB_CLAIM_CANDIDATE_GONE', 404, 'That character is no longer on this hub. Pick another.'],
        ['HUB_CLAIM_VIEWER_HAS_CLAIM', 409, 'You already have a character on this hub.'],
    ])('%s is a warning that refetches the status', (code, status, message) => {
        expect(hubClaimErrorView(httpError(status, code))).toEqual({ tone: 'warning', message, refresh: true });
    });

    it('a bare 409 with no known code is a warning that refetches', () => {
        expect(hubClaimErrorView(httpError(409))).toEqual({
            tone: 'warning', message: "We couldn't claim that character. Try again in a moment.", refresh: true,
        });
    });

    it.each([
        ['a 500', httpError(500)],
        ['a 400 with an unknown code', httpError(400, 'HUB_CLAIM_BAD_OPTIONS')],
        ['a network error', new TypeError('Failed to fetch')],
    ])('%s is the generic danger banner, no refetch', (_label, error) => {
        expect(hubClaimErrorView(error)).toEqual({
            tone: 'danger', message: "We couldn't claim that character. Try again in a moment.", refresh: false,
        });
    });
});
