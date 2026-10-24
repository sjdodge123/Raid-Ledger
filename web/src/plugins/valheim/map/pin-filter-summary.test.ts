import { describe, expect, it } from 'vitest';
import { portalLayerFailed, portalsOmittedText } from './pin-filter-summary';

const failed = (status: number | undefined) =>
    portalLayerFailed({ isError: true, error: Object.assign(new Error('x'), status === undefined ? {} : { status }) });

describe('portal layer summary (ROK-1946 D15)', () => {
    it('a hub 404 is "no layer", not a failure; any other error (or none) is', () => {
        expect(failed(404)).toBe(false);
        expect(failed(500)).toBe(true);
        expect(failed(undefined)).toBe(true);
        expect(portalLayerFailed({ isError: false, error: null })).toBe(false);
    });

    it('the omitted line names the count', () => {
        expect(portalsOmittedText(3)).toBe('Some portals were not uploaded (3).');
    });
});
