/**
 * ROK-1573/1572/1571 — the LFG group page's top row (approved option 4),
 * mirroring `LineupDetailHeader`: back chevron on the left; the copy-group-link
 * icon and the `⋯` Manage icon on the right. No title — `LfgHeader`'s game
 * banner sits directly under it.
 *
 * Both icon buttons are 44px on phones, compact from `lg`.
 */
import type { JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { EllipsisHorizontalIcon, LinkIcon } from '@heroicons/react/24/outline';
import { copyWithToast } from '../../lib/clipboard';
import { LFG_COPY } from './lfg-copy';
import { LFG_ICON_BTN } from './lfg-action-buttons';

export interface LfgTopBarProps {
    /** Opens the Manage dialog (when to play, leave the group). */
    onManage: () => void;
    /** False hides `⋯` — e.g. a viewer with no intent has nothing to manage. */
    canManage?: boolean;
}

/** Copy the page the viewer is on — the group's canonical URL. */
function copyGroupLink(): void {
    void copyWithToast(window.location.href, {
        success: LFG_COPY.copyLinkSuccess,
        error: LFG_COPY.copyLinkFailed,
    });
}

/** ‹ back — history back, like the lineup header. */
function BackButton(): JSX.Element {
    const navigate = useNavigate();
    return (
        <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] lg:min-h-[32px] lg:min-w-[32px] -ml-2.5 text-muted hover:text-foreground transition flex-shrink-0"
            aria-label={LFG_COPY.goBack}
        >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
        </button>
    );
}

/** The copy-group-link icon (the `LineupShareCopy` look). */
function CopyLinkButton(): JSX.Element {
    return (
        <button
            type="button"
            onClick={copyGroupLink}
            data-testid="lfg-copy-link"
            aria-label={LFG_COPY.copyLinkLabel}
            title={LFG_COPY.copyLinkLabel}
            className={LFG_ICON_BTN}
        >
            <LinkIcon className="w-4 h-4" aria-hidden="true" />
            <span className="hidden sm:inline ml-1">{LFG_COPY.copyLink}</span>
        </button>
    );
}

/** The `⋯` that opens Manage. */
function ManageButton({ onManage }: { onManage: () => void }): JSX.Element {
    return (
        <button
            type="button"
            onClick={onManage}
            data-testid="lfg-manage"
            aria-haspopup="dialog"
            aria-label={LFG_COPY.manage}
            title={LFG_COPY.manage}
            className={LFG_ICON_BTN}
        >
            <EllipsisHorizontalIcon className="w-5 h-5" aria-hidden="true" />
        </button>
    );
}

/** Back ‹ · (copy link, ⋯ manage). */
export function LfgTopBar({ onManage, canManage = true }: LfgTopBarProps): JSX.Element {
    return (
        <div data-testid="lfg-top-bar" className="flex w-full items-center justify-between gap-2">
            <BackButton />
            <div className="flex items-center gap-2 flex-shrink-0">
                <CopyLinkButton />
                {canManage && <ManageButton onManage={onManage} />}
            </div>
        </div>
    );
}
