import { describe, it, expect } from 'vitest';
import { DESKTOP_MQ, PHONE_MQ } from './breakpoints';

/**
 * ROK-1584 lane F: tablets get the phone layout. The two media queries below
 * are the single source of truth for that split — a drift back to 768 would
 * silently hand iPads the desktop layout again, so pin the literals.
 */
describe('breakpoints', () => {
    it('puts the desktop layout at 1024px and up', () => {
        expect(DESKTOP_MQ).toBe('(min-width: 1024px)');
    });

    it('puts the phone layout at 1023px and below', () => {
        expect(PHONE_MQ).toBe('(max-width: 1023px)');
    });

    it('keeps the two queries complementary', () => {
        const desktopMin = Number(DESKTOP_MQ.match(/(\d+)px/)![1]);
        const phoneMax = Number(PHONE_MQ.match(/(\d+)px/)![1]);
        expect(phoneMax).toBe(desktopMin - 1);
    });
});
