/**
 * Scoped light/dark columns for /dev/design-system (ROK-1539).
 *
 * The two families are NOT symmetric, and the shape of this component is a
 * direct consequence:
 *
 *  - **Light cascades.** Every light scheme declares its tokens on an
 *    unqualified `[data-scheme=...]` selector (`index.css:75`, plus `:158`
 *    `sky` / `:210` `dawn` / `:262` `holy` / `:314` `celestial`), which matches
 *    a nested element just as happily as `<html>`. So the light column is a
 *    genuinely scoped `<div data-scheme="light">`.
 *  - **Dark does not.** The dark values live on `@theme` (`:32`) and `html`
 *    (`:65`) — root-only, with no `[data-scheme="dark"]` block to match a
 *    nested wrapper. A scoped dark column inside a light root would inherit the
 *    LIGHT tokens. So the dark column carries no scheme attribute at all: it
 *    shows the ROOT, and the page forces the root to `default-dark` while this
 *    view is on (see `useForcedDarkRoot`). Documented as a divergence in
 *    docs/design-system.md §6.
 *
 * Root-only either way — check these at the root, not here: `color-scheme`
 * (`:576-590`, native form controls and scrollbars), the page background on
 * `body` / `#root` (`:592`, `:599`), quest-log's parchment on
 * `[data-variant="quest-log"] body::before` / `body::after` (`:1228`, `:1241`), and
 * `ThemeParticles` (mounted app-level).
 */
import type { JSX, ReactNode } from 'react';
import { ScopedFamilyContext } from './family-scope';

/** One column of the two-family view. `scheme` is omitted for the dark column. */
export function FamilyColumn({ family, scheme, label, children }: {
    family: 'dark' | 'light';
    scheme?: 'light';
    label: string;
    children: ReactNode;
}): JSX.Element {
    return (
        <div
            data-scheme={scheme}
            data-testid={`ds-family-${family}`}
            className="bg-backdrop border border-edge rounded-lg p-4 min-w-0"
        >
            <div className="text-[10px] uppercase tracking-wider text-muted mb-4">{label}</div>
            <ScopedFamilyContext.Provider value={true}>{children}</ScopedFamilyContext.Provider>
        </div>
    );
}

/** Renders `children` twice, once per colour family, side by side. */
export function DualFamily({ children }: { children: ReactNode }): JSX.Element {
    return (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start" data-testid="ds-side-by-side">
            <FamilyColumn family="dark" label="default-dark — inherited from the root">
                {children}
            </FamilyColumn>
            <FamilyColumn family="light" scheme="light" label="default-light — scoped data-scheme">
                {children}
            </FamilyColumn>
        </div>
    );
}
