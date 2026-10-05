/**
 * Inline `danger` status banner for a failed import (design-system §4.7, §4.8:
 * an error the user must act on is inline, not a toast). The `NAME_MISMATCH`
 * action is a router `Link` carrying the Add Character prefill as state.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { addonImportErrorCopy } from './addon-import-errors';

export interface AddonImportErrorBannerProps {
    error: unknown;
    /** The open character's game id — needed for the Add Character prefill. */
    gameId?: number | undefined;
}

export function AddonImportErrorBanner({ error, gameId }: AddonImportErrorBannerProps): JSX.Element {
    const copy = addonImportErrorCopy(error, gameId);
    return (
        <div role="alert" data-testid="addon-import-error" className="p-3 rounded-lg border bg-danger/10 border-danger/30">
            <p className="text-sm font-medium text-danger">{copy.title}</p>
            <p className="mt-1 text-sm text-secondary">{copy.body}</p>
            {copy.action && (
                <Link to={copy.action.to} state={copy.action.state} className="mt-2 inline-flex min-h-[44px] items-center text-sm font-medium text-foreground underline">
                    {copy.action.label}
                </Link>
            )}
        </div>
    );
}
