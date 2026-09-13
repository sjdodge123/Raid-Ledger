/**
 * Shared chrome for the /dev/design-system reference page (ROK-1539).
 * Section wrapper, state-label frame, and the DO / DON'T callouts, kept here
 * so each section file stays a list of examples rather than layout code.
 */
import type { JSX, ReactNode } from 'react';

/** One titled section of the reference page. */
export function Section({ id, title, blurb, children }: {
    id: string;
    title: string;
    blurb: string;
    children: ReactNode;
}): JSX.Element {
    return (
        <section id={id} className="mb-12 scroll-mt-4">
            <div className="border-b border-edge pb-2 mb-4">
                <h2 className="text-lg font-semibold text-foreground">{title}</h2>
                <p className="text-sm text-secondary mt-1">{blurb}</p>
            </div>
            {children}
        </section>
    );
}

/** A labelled example frame — the label names the state being shown. */
export function StateFrame({ label, note, children }: {
    label: string;
    note?: string;
    children: ReactNode;
}): JSX.Element {
    return (
        <div className="bg-panel/50 border border-edge rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted mb-2">{label}</div>
            <div className="flex flex-wrap items-center gap-3">{children}</div>
            {note && <p className="text-[10px] text-dim mt-2">{note}</p>}
        </div>
    );
}

/** Grid of state frames. */
export function StateGrid({ children }: { children: ReactNode }): JSX.Element {
    return <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{children}</div>;
}

/** Green-bordered "this is the pattern" callout. */
export function DoBlock({ title, children }: { title: string; children: ReactNode }): JSX.Element {
    return (
        <div>
            <div className="text-xs uppercase tracking-wider text-emerald-400 mb-2">DO — {title}</div>
            <div className="bg-panel/50 border border-emerald-500/30 rounded-lg p-3">{children}</div>
        </div>
    );
}

/** Red-bordered "this is the divergence" callout. */
export function DontBlock({ title, children }: { title: string; children: ReactNode }): JSX.Element {
    return (
        <div>
            <div className="text-xs uppercase tracking-wider text-red-400 mb-2">DON'T — {title}</div>
            <div className="bg-panel/50 border border-red-500/20 rounded-lg p-3">{children}</div>
        </div>
    );
}

/** Two-up comparison layout. */
export function SideBySide({ children }: { children: ReactNode }): JSX.Element {
    return <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">{children}</div>;
}
