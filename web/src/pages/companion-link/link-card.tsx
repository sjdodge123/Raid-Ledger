/** ROK-1955 — the card frame every `/link` state renders in. */
import type { JSX, ReactNode } from 'react';

/** Card surface (§4.2) with an optional page-level title. */
export function LinkCard({ title, children }: { title?: string; children: ReactNode }): JSX.Element {
    return (
        <section className="bg-surface border border-edge rounded-lg p-5">
            {title && <h1 className="text-xl font-semibold text-foreground mb-1">{title}</h1>}
            {children}
        </section>
    );
}
