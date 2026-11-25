/**
 * The shared "not found" state (ROK-2319): a centred, quiet notice with an optional
 * heading and a way out. Lifted from the hub page's `NotFoundNotice`
 * (`components/hub/hub-page-error.tsx`), which now renders through it, and used by the
 * catch-all route (`pages/not-found-page.tsx`) so an unknown URL is never a blank page.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { buttonClass } from '../ui/button-classes';

export interface NotFoundStateProps {
    testId: string;
    message: string;
    title?: string | undefined;
    /** A router link out, drawn as a secondary button. */
    action?: { to: string; label: string } | undefined;
}

export function NotFoundState({ testId, message, title, action }: NotFoundStateProps): JSX.Element {
    return (
        <div data-testid={testId} className="py-12 text-center">
            {title && <h1 className="text-xl font-semibold text-foreground">{title}</h1>}
            <p className={title ? 'mt-2 text-sm text-muted' : 'text-sm text-muted'}>{message}</p>
            {action && (
                <Link to={action.to} className={buttonClass({ variant: 'secondary', className: 'mt-6' })}>
                    {action.label}
                </Link>
            )}
        </div>
    );
}
