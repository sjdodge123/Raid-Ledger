/**
 * Inline `danger` status banner for a failed import (design-system §4.7, §4.8:
 * an error the user must act on is inline, not a toast). The `NAME_MISMATCH`
 * action is a router `Link` carrying the Add Character prefill as state.
 * `RULESET_CONFIRM_STALE` (ROK-1739, Codex r3 P2) offers "Preview again" when
 * the caller passes `onPreviewAgain`: the refused apply committed nothing, and
 * the fresh preview re-warns with the realm map's new value to confirm.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../../../components/ui/button';
import { addonImportErrorCopy } from './addon-import-errors';
import { AddonImportRequestError } from './use-addon-import';

export interface AddonImportErrorBannerProps {
    error: unknown;
    /** The open character's game id — needed for the Add Character prefill. */
    gameId?: number | undefined;
    /** Re-runs the preview with the same import string (stale-confirmation recovery). */
    onPreviewAgain?: (() => void) | undefined;
    /** True while that re-preview is in flight. */
    previewing?: boolean | undefined;
}

function isStaleConfirm(error: unknown): boolean {
    return error instanceof AddonImportRequestError && error.code === 'RULESET_CONFIRM_STALE';
}

export function AddonImportErrorBanner({ error, gameId, onPreviewAgain, previewing }: AddonImportErrorBannerProps): JSX.Element {
    const copy = addonImportErrorCopy(error, gameId);
    const previewAgain = isStaleConfirm(error) ? onPreviewAgain : undefined;
    return (
        <div role="alert" data-testid="addon-import-error" className="p-3 rounded-lg border bg-danger/10 border-danger/30">
            <p className="text-sm font-medium text-danger">{copy.title}</p>
            <p className="mt-1 text-sm text-secondary">{copy.body}</p>
            {copy.action && (
                <Link to={copy.action.to} state={copy.action.state} className="mt-2 inline-flex min-h-[44px] items-center text-sm font-medium text-foreground underline">
                    {copy.action.label}
                </Link>
            )}
            {previewAgain && (
                <Button variant="secondary" className="mt-2" loading={previewing === true} loadingLabel="Checking…" onClick={previewAgain}>
                    Preview again
                </Button>
            )}
        </div>
    );
}
