/** ROK-1870 — point `useMediaQuery(DESKTOP_MQ)` at desktop or phone for one spec. */
import { vi } from 'vitest';
import { DESKTOP_MQ } from '../../lib/breakpoints';

/** Make `(min-width: 1024px)` match (`true`) or not; restore with `vi.restoreAllMocks()`. */
export function mockDesktop(isDesktop: boolean): void {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string): MediaQueryList => ({
        matches: query === DESKTOP_MQ ? isDesktop : query.includes('dark'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: () => true,
    }));
}
