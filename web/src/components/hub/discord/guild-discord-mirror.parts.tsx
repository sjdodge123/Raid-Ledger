/**
 * ROK-2185 — the Discord mirror card's chrome, split out of
 * `guild-discord-mirror.tsx` to keep it under the size cap: the error state
 * with Retry, the read-only footer, the Private tag, the Show more toggle and
 * the header actions (Refresh, Private tag, Change channel).
 */
import type { JSX } from 'react';
import { ArrowPathIcon, ArrowTopRightOnSquareIcon, LockClosedIcon } from '@heroicons/react/24/outline';
import type { GuildKind } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { FOCUS_RING } from '../../ui/form-classes';
import { Pill } from '../hub-bits';
import { privateTagTitle } from '../hub-copy';
import { safeHttpUrl } from '../../../lib/safe-http-url';
import type { BoundMirror } from './guild-discord.helpers';

/** In-card error with a Retry (precedent `CrestPickerLoadError`). */
export function MirrorError({ onRetry }: { onRetry: () => void }): JSX.Element {
    return (
        <div className="flex flex-col items-start gap-3">
            <p role="alert" className="w-full rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger" data-testid="guild-discord-error">
                Couldn’t load the Discord channel.
            </p>
            <Button variant="secondary" size="sm" onClick={onRetry} data-testid="guild-discord-retry">Retry</Button>
        </div>
    );
}

export function MirrorFooter({ url: rawUrl }: { url: string }): JSX.Element {
    const url = safeHttpUrl(rawUrl);
    return (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-edge pt-1">
            <p className="inline-flex items-center gap-1.5 text-xs text-muted">
                <LockClosedIcon className="h-3.5 w-3.5" aria-hidden="true" /> Read-only · reply in Discord
            </p>
            {url && <a href={url} target="_blank" rel="noopener noreferrer" data-testid="guild-discord-open"
                className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-sm text-sm font-medium text-success hover:underline ${FOCUS_RING}`}>
                Open in Discord <ArrowTopRightOnSquareIcon className="h-4 w-4" aria-hidden="true" />
            </a>}
        </div>
    );
}

interface ToggleProps { expanded: boolean; controls: string; onToggle: () => void }

/** Show more / Show less (precedent `posts/post-item.tsx`). */
export function ShowMoreToggle({ expanded, controls, onToggle }: ToggleProps): JSX.Element {
    return (
        <Button variant="ghost" size="sm" aria-expanded={expanded} aria-controls={controls} onClick={onToggle}
            className="mt-1" data-testid="guild-discord-show-more">
            {expanded ? 'Show less' : 'Show more'}
        </Button>
    );
}

/** Spec D8/§UI: a private bound channel carries a "Private" tag on the card itself, for every viewer. */
function PrivateTag({ kind }: { kind: GuildKind | undefined }): JSX.Element {
    return (
        <span data-testid="guild-discord-private" title={privateTagTitle(kind)}>
            <Pill><LockClosedIcon className="h-3 w-3" aria-hidden="true" /> Private</Pill>
        </span>
    );
}

/** ROK-2185 Q1 = A: skips the server's 60s cache (15s floor); disabled while any fetch runs. */
function RefreshButton({ fetching, onRefresh }: { fetching: boolean; onRefresh: () => void }): JSX.Element {
    return (
        <Button variant="ghost" size="sm" iconOnly aria-label="Refresh messages" title="Refresh messages"
            disabled={fetching} onClick={onRefresh} data-testid="guild-discord-refresh">
            <ArrowPathIcon className={`h-4 w-4${fetching ? ' motion-safe:animate-spin' : ''}`} aria-hidden="true" />
        </Button>
    );
}

interface HeaderActionProps {
    mirror: BoundMirror;
    onChange: (() => void) | null;
    kind: GuildKind | undefined;
    fetching: boolean;
    onRefresh: () => void;
}

/** Header slot of a bound card: the Private tag, Refresh, and Change channel for pickers. */
export function MirrorHeaderAction({ mirror, onChange, kind, fetching, onRefresh }: HeaderActionProps): JSX.Element {
    const isPrivate = mirror.state === 'ok' && mirror.channel.visibility === 'private';
    return (
        <div className="flex items-center gap-2">
            {isPrivate && <PrivateTag kind={kind} />}
            <RefreshButton fetching={fetching} onRefresh={onRefresh} />
            {onChange && <Button variant="ghost" size="sm" onClick={onChange} data-testid="guild-discord-change">Change channel</Button>}
        </div>
    );
}
