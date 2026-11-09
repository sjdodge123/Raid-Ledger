/**
 * The `/hubs/:id` page's failure notices, moved out of `hub-page.tsx` (ROK-2132 R3).
 * A 403 is "plugin off" (ROK-2044), a members-only hub's join gate (ROK-2132 —
 * the module for the 403's `kind` supplies `nonMemberGate`; core never imports
 * a plugin), or today's not-a-member notice; 404 is not found; anything else
 * offers a retry.
 */
import { Suspense, type JSX, type ReactNode } from 'react';
import type { GuildKind } from '@raid-ledger/contract';
import { Button } from '../ui/button';
import { httpStatusOf } from '../../lib/api/api-error';
import { useHubModule } from '../../plugins/hub-module';
import { usePluginsHydrated } from '../../hooks/use-plugins';
import { hubCopy, loadFailedLabel } from './hub-copy';
import { hubNotMemberKind, isHubPluginInactive } from './hub-plugin-inactive.helpers';
import { HubPluginInactiveCopy } from './hub-plugin-inactive';

/**
 * Phone: the app shell (`Layout.tsx` `<main>`) already pads past the bottom bar, the raised Hubs circle and a
 * Filters FAB (ROK-2156), so this adds no phone bottom padding. At 768-1023px a tab's Filters FAB (Materials,
 * Planner) still floats over the last card, so the page pads past it there (ROK-1889).
 */
export const PAGE = 'max-w-5xl mx-auto px-4 pt-8 md:pb-[max(2rem,var(--filter-fab-clearance))]';

export function Notice({ testId, children }: { testId: string; children: ReactNode }): JSX.Element {
    return <div className={PAGE}><div data-testid={testId} className="py-12 text-center">{children}</div></div>;
}

/** The page skeleton while the page, the plugin list or a join gate is still arriving. */
export function LoadingState(): JSX.Element {
    return (
        <div className={PAGE} aria-busy="true" data-testid="guild-loading">
            <div className="mb-4 h-28 animate-pulse rounded-xl border border-edge bg-panel" />
            <div className="h-64 animate-pulse rounded-lg border border-edge bg-surface" />
        </div>
    );
}

const NOT_FOUND_COPY = "This guild doesn't exist. Check the link and try again.";

export function NotFoundNotice(): JSX.Element {
    return <Notice testId="guild-not-found"><p className="text-sm text-muted">{NOT_FOUND_COPY}</p></Notice>;
}

interface ErrorStateProps {
    error: Error;
    onRetry: () => unknown;
    /** The hub kind when known (a module load failure); a page 403/5xx has none and reads as a WoW guild. */
    kind?: GuildKind | undefined;
    /** The hub being opened — a module's join gate needs it (ROK-2132). */
    guildId?: number | undefined;
}

/** The not-a-member 403: the hub module's join gate when it has one, else today's notice. */
function NotMemberState({ error, kind, guildId }: Pick<ErrorStateProps, 'error' | 'kind' | 'guildId'>): JSX.Element {
    const gateKind = hubNotMemberKind(error);
    const mod = useHubModule(gateKind ?? '');
    const pluginsHydrated = usePluginsHydrated();
    const Gate = mod?.nonMemberGate;
    const hasGuild = guildId !== undefined && guildId > 0;
    // Until the plugin list settles the module (and its gate) may be missing — don't flash the notice first.
    if (gateKind !== undefined && hasGuild && !Gate && !pluginsHydrated) return <LoadingState />;
    if (Gate && hasGuild) {
        return <Suspense fallback={<LoadingState />}><div className={PAGE}><Gate guildId={guildId} /></div></Suspense>;
    }
    return <Notice testId="guild-not-member"><p className="text-sm text-muted">{hubCopy(kind).notMember}</p></Notice>;
}

/** The hub page's failure notices — plugin off, join gate or not-a-member (403), not-found (404), or a retryable load failure. */
export function ErrorState({ error, onRetry, kind, guildId }: ErrorStateProps): JSX.Element {
    const status = httpStatusOf(error);
    if (isHubPluginInactive(error)) return <Notice testId="guild-plugin-inactive"><HubPluginInactiveCopy /></Notice>;
    if (status === 403) return <NotMemberState error={error} kind={kind} guildId={guildId} />;
    if (status === 404) return <NotFoundNotice />;
    return (
        <Notice testId="guild-error">
            <p className="mb-4 text-sm text-muted">{loadFailedLabel(kind)}</p>
            <Button variant="secondary" onClick={() => void onRetry()}>Try again</Button>
        </Notice>
    );
}
