/**
 * Public-share toggle (ROK-1067).
 *
 * Used in two contexts:
 *   1. Lineup-creation modal — sits next to the visibility toggle. Only
 *      renders when `visibility === 'public'`. Default ON.
 *   2. Detail-page header — operator-only, with an inline copy-link button
 *      that writes `${origin}/p/lineup/${slug}` to the clipboard.
 */
import type { JSX } from 'react';
import { copyWithToast } from '../../lib/clipboard';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';

interface PublicShareToggleProps {
    enabled: boolean;
    onChange: (next: boolean) => void;
    /** Optional slug — when provided, renders a copy-link button. */
    slug?: string;
    /** Optional disabled flag (e.g. while a mutation is pending). */
    disabled?: boolean;
}

function copyLink(slug: string): void {
    const url = `${window.location.origin}/p/lineup/${slug}`;
    void copyWithToast(url, {
        success: 'Public link copied',
        error: 'Failed to copy link',
    });
}

/** Visible title + state line; the Switch carries the same name as its label. */
function ShareSummary({ enabled }: { enabled: boolean }): JSX.Element {
    return (
        <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Public share link</p>
            <p className="text-xs text-muted mt-0.5">
                {enabled
                    ? 'Anyone with the link can view this lineup.'
                    : 'Lineup is private to members.'}
            </p>
        </div>
    );
}

/** Copy link (when a slug exists and sharing is on) beside the on/off Switch. */
function ShareControls({ enabled, onChange, slug, disabled }: Required<Omit<PublicShareToggleProps, 'slug'>> & {
    slug?: string;
}): JSX.Element {
    return (
        <div className="flex items-center gap-2 flex-shrink-0">
            {slug && enabled && (
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => copyLink(slug)}
                    disabled={disabled}
                    data-testid="public-share-copy"
                    aria-label="Copy public link"
                >
                    Copy link
                </Button>
            )}
            <Switch
                checked={enabled}
                onChange={onChange}
                label="Public share link"
                disabled={disabled}
                testId="public-share-switch"
            />
        </div>
    );
}

export function PublicShareToggle({
    enabled,
    onChange,
    slug,
    disabled = false,
}: PublicShareToggleProps): JSX.Element {
    return (
        <div
            data-testid="public-share-toggle"
            className="flex items-center justify-between gap-3 p-3 rounded border border-edge/40 bg-overlay/30"
        >
            <ShareSummary enabled={enabled} />
            <ShareControls enabled={enabled} onChange={onChange} slug={slug} disabled={disabled} />
        </div>
    );
}
