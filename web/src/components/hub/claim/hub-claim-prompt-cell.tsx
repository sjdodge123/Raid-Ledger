/**
 * ROK-2153 S3b — the eager half of the core "claim your character" prompt,
 * mounted in the hub Overview grid right after the Companion prompt. It runs
 * only the free gate (a claim provider registered for an active plugin, this
 * hub's game and kind) and lazy-loads the card, so the `hub-page` chunk never
 * carries the card, the claim hooks or the list overlay while no plugin asks.
 */
import { lazy, Suspense, type JSX } from 'react';
import type { HubCtx } from '../../../plugins/hub-module';
import { usePluginStore } from '../../../stores/plugin-store';
import { gatedHubClaimProvider } from './hub-claim-providers';
import type { HubClaimShowing } from './hub-claim-prompt';

const HubClaimPrompt = lazy(() => import('./hub-claim-prompt').then((m) => ({ default: m.HubClaimPrompt })));

interface HubClaimPromptCellProps {
    /** Reads only `ctx.page`, so it takes just that slice of the hub context. */
    ctx: Pick<HubCtx, 'page'>;
    /** Told whether the card is pending, showing or hidden, so the Overview shows one banner at a time (§4.7). */
    onShowingChange?: ((state: HubClaimShowing) => void) | undefined;
}

export function HubClaimPromptCell({ ctx, onShowingChange }: HubClaimPromptCellProps): JSX.Element | null {
    const activeSlugs = usePluginStore((s) => s.activeSlugs);
    const registration = gatedHubClaimProvider(ctx.page, activeSlugs);
    if (registration === undefined) return null;
    const guildId = ctx.page.guild.id;
    return (
        <Suspense fallback={null}>
            <HubClaimPrompt key={guildId} guildId={guildId} registration={registration} onShowingChange={onShowingChange} />
        </Suspense>
    );
}
