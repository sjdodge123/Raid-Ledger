/** ROK-1955 — the card frame every `/link` state renders in. */
import { useEffect, useRef } from 'react';
import type { JSX, ReactNode } from 'react';

/**
 * Card surface (§4.2) with an optional page-level title. Each step mounts a
 * new card and unmounts the button that was clicked, so focus would drop to
 * `<body>`; the new card's heading takes it instead (only when focus was lost,
 * never stealing it from a field).
 */
export function LinkCard({ title, children }: { title?: string; children: ReactNode }): JSX.Element {
    const heading = useRef<HTMLHeadingElement>(null);
    useEffect(() => {
        const active = document.activeElement;
        if (active === null || active === document.body) heading.current?.focus();
    }, []);
    return (
        <section className="bg-surface border border-edge rounded-lg p-5">
            {title && (
                <h1 ref={heading} tabIndex={-1} className="text-xl font-semibold text-foreground mb-1 focus:outline-none">
                    {title}
                </h1>
            )}
            {children}
        </section>
    );
}
