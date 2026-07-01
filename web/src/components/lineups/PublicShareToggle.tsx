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
            <div className="flex-1 min-w-0">
                <label className="block text-sm font-medium">
                    Public share link
                </label>
                <p className="text-xs text-muted mt-0.5">
                    {enabled
                        ? 'Anyone with the link can view this lineup.'
                        : 'Lineup is private to members.'}
                </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
                {slug && enabled && (
                    <button
                        type="button"
                        onClick={() => copyLink(slug)}
                        disabled={disabled}
                        data-testid="public-share-copy"
                        className="px-2.5 py-1.5 text-xs rounded border border-edge/50 hover:bg-overlay/50 disabled:opacity-50"
                        aria-label="Copy public link"
                    >
                        Copy link
                    </button>
                )}
                <label className="inline-flex items-center cursor-pointer select-none">
                    <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) => onChange(e.target.checked)}
                        disabled={disabled}
                        className="sr-only peer"
                    />
                    <span className="w-9 h-5 bg-zinc-700 peer-checked:bg-emerald-500 rounded-full relative transition-colors peer-disabled:opacity-50">
                        <span
                            className={`absolute top-0.5 left-0.5 h-4 w-4 bg-white rounded-full transition-transform ${
                                enabled ? 'translate-x-4' : ''
                            }`}
                        />
                    </span>
                </label>
            </div>
        </div>
    );
}
