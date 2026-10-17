/**
 * ROK-1787 — small shared bits for the Raids widgets: the in-page jump to the
 * Raids tab and the quiet in-card empty state (design-system §4.5).
 */
import type { JSX, ReactNode } from 'react';
import { FOCUS_RING } from '../../../components/ui/form-classes';

/** Plain `<a href>`: `useHashTab` follows hashchange, which a router `<Link>` never fires. */
export function JumpLink({ testId, children }: { testId: string; children: ReactNode }): JSX.Element {
    return (
        <a href="#raids" data-testid={testId}
            className={`rounded-sm text-sm font-medium text-success underline-offset-2 hover:underline ${FOCUS_RING}`}>
            {children}
        </a>
    );
}

/** Centred, quiet, one sentence that says what happens next. */
export function QuietEmpty({ children }: { children: ReactNode }): JSX.Element {
    return <p className="mb-4 py-4 text-center text-sm text-muted">{children}</p>;
}

/** Card footer line ("Shown in your local time", "Last 8 weeks"). */
export function CardFootnote({ children }: { children: ReactNode }): JSX.Element {
    return <p className="mt-3 text-xs text-dim">{children}</p>;
}
