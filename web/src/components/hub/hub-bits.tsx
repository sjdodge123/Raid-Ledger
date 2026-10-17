/**
 * ROK-1785 — small presentational bits shared by the guild page, copied from
 * the approved prototype (`spike/rok-1781-guild-page-prototype`,
 * `guild-bits.tsx` + `proposed/proposed-bits.tsx`). Tokens only.
 */
import type { JSX, ReactNode } from 'react';

type PillTone = 'neutral' | 'success' | 'warning';

const PILL_TONE: Record<PillTone, string> = {
    neutral: 'border-edge bg-panel text-secondary',
    success: 'border-success/30 bg-success/10 text-success',
    warning: 'border-warning/30 bg-warning/10 text-warning',
};

/** Read-only status pill, design-system §4.3. */
export function Pill({ tone = 'neutral', children }: { tone?: PillTone; children: ReactNode }): JSX.Element {
    return (
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${PILL_TONE[tone]}`}>
            {children}
        </span>
    );
}

interface SectionTitleProps {
    title: string;
    blurb?: string;
    /** Optional trailing control (prototype: the Discord mirror's "Change channel"). */
    action?: ReactNode;
    headingId?: string;
}

/** Section title, design-system §4.10. */
export function SectionTitle({ title, blurb, action, headingId }: SectionTitleProps): JSX.Element {
    const text = (
        <>
            <h2 id={headingId} className="text-lg font-semibold text-foreground">{title}</h2>
            {blurb && <p className="text-sm text-secondary">{blurb}</p>}
        </>
    );
    if (!action) return <div className="mb-4 border-b border-edge pb-2">{text}</div>;
    return (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2 border-b border-edge pb-2">
            <div className="min-w-0">{text}</div>
            {action}
        </div>
    );
}

/** Card surface, design-system §4.2. */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }): JSX.Element {
    return <div className={`rounded-lg border border-edge bg-surface p-4 ${className}`}>{children}</div>;
}

interface WidgetCardProps {
    id: string;
    title: string;
    children: ReactNode;
    /** Optional header control (e.g. the "See roster" jump link). */
    action?: ReactNode;
}

/** One Overview bento widget: a titled card section (prototype `ProposedCard`). */
export function WidgetCard({ id, title, children, action }: WidgetCardProps): JSX.Element {
    const headingId = `${id}-title`;
    return (
        <section id={id} aria-labelledby={headingId} className="scroll-mt-4">
            <Card className="flex h-full flex-col gap-3">
                <header className="flex flex-wrap items-center justify-between gap-2">
                    <h3 id={headingId} className="text-base font-semibold text-foreground">{title}</h3>
                    {action}
                </header>
                <div className="flex-1">{children}</div>
            </Card>
        </section>
    );
}
