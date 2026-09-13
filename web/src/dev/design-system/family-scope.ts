/**
 * Scope flag for the /dev/design-system two-family view (ROK-1539).
 *
 * Lives in its own module so `dual-family.tsx` can stay components-only
 * (react-refresh/only-export-components).
 */
import { createContext, useContext } from 'react';

/** True inside a family column — every section is rendered twice there. */
export const ScopedFamilyContext = createContext(false);

/**
 * True when the subtree is rendering inside a family column — used to drop
 * duplicate DOM ids (and their anchor targets) from the second copy.
 */
export function useIsScopedFamily(): boolean {
    return useContext(ScopedFamilyContext);
}
