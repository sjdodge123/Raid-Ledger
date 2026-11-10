/**
 * ROK-2056 L4 — the eager half of the Companion prompt, mounted first in the
 * hub Overview grid. It runs only the free gates (download flag, registered
 * prompt for this plugin/game/kind, member) and lazy-loads the card, so the
 * `hub-page` chunk never carries the card, its onboarding hook or the device
 * query while the flag is off or no plugin asks.
 */
import { lazy, Suspense, type JSX } from 'react';
import type { HubCtx } from '../../../plugins/hub-module';
import { usePluginStore } from '../../../stores/plugin-store';
import { gatedHubCompanionPrompt } from './hub-companion-prompts';

const CompanionInstallPrompt = lazy(() => import('./companion-install-prompt').then((m) => ({ default: m.CompanionInstallPrompt })));

interface HubCompanionPromptCellProps {
    /** Reads only `ctx.page`, so it takes just that slice of the hub context. */
    ctx: Pick<HubCtx, 'page'>;
    /** Another Overview banner is showing (§4.7 one banner at a time): render nothing for now. */
    suppressed?: boolean | undefined;
}

export function HubCompanionPromptCell({ ctx, suppressed = false }: HubCompanionPromptCellProps): JSX.Element | null {
    const activeSlugs = usePluginStore((s) => s.activeSlugs);
    const registration = gatedHubCompanionPrompt(ctx.page, activeSlugs);
    if (registration === undefined || suppressed) return null;
    const guildId = ctx.page.guild.id;
    return (
        <Suspense fallback={null}>
            <CompanionInstallPrompt key={guildId} guildId={guildId} registration={registration} />
        </Suspense>
    );
}
