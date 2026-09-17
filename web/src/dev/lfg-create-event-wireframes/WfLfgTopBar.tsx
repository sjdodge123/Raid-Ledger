/**
 * ROK-1573/1572/1571 — option 4's top row for the LFG group page, mirroring
 * `LineupDetailHeader`: back chevron on the left; the copy-group-link icon
 * (the `LineupShareCopy` icon look) and a `⋯` menu icon on the right. No
 * title — today's game banner (`LfgHeader`) sits directly under it.
 *
 * The `⋯` opens the existing Manage dialog. Both icon buttons are 44px on
 * phones, compact from `lg`.
 */
import type { JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { EllipsisHorizontalIcon, LinkIcon } from '@heroicons/react/24/outline';
import { copyWithToast } from '../../lib/clipboard';
import { WF_COPY } from './wireframe-variants';

/** 44px phone target, the lineup header's 32px from `lg`. */
const ICON_BTN =
    'inline-flex items-center justify-center min-h-[44px] min-w-[44px] lg:min-h-[32px] lg:min-w-[32px] ' +
    'px-2.5 py-1.5 text-xs text-muted hover:text-foreground rounded border border-edge/50 hover:bg-overlay/50 ' +
    'transition-colors flex-shrink-0';

export interface WfLfgTopBarProps {
    onManage: () => void;
}

/** Wireframe copy target — the page the viewer is on. */
function copyGroupLink(): void {
    void copyWithToast(window.location.href, { success: 'Group link copied', error: 'Failed to copy link' });
}

/** Back ‹ · (copy link, ⋯ manage). */
export function WfLfgTopBar({ onManage }: WfLfgTopBarProps): JSX.Element {
    const navigate = useNavigate();
    return (
        <div data-testid="wf-lfg-top-bar" className="flex w-full items-center justify-between gap-2">
            <button
                type="button"
                onClick={() => navigate(-1)}
                className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] lg:min-h-[32px] lg:min-w-[32px] -ml-2.5 text-muted hover:text-foreground transition flex-shrink-0"
                aria-label="Go back"
            >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
            </button>
            <div className="flex items-center gap-2 flex-shrink-0">
                <button type="button" onClick={copyGroupLink} data-testid="wf-copy-link" aria-label="Copy group link" title="Copy group link" className={ICON_BTN}>
                    <LinkIcon className="w-4 h-4" aria-hidden="true" />
                    <span className="hidden sm:inline ml-1">Copy link</span>
                </button>
                <button type="button" onClick={onManage} data-testid="wf-manage" aria-haspopup="dialog" aria-label={WF_COPY.manage} title={WF_COPY.manage} className={ICON_BTN}>
                    <EllipsisHorizontalIcon className="w-5 h-5" aria-hidden="true" />
                </button>
            </div>
        </div>
    );
}
