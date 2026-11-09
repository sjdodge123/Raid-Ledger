/**
 * ROK-2151 — the staff "Claim your character" banner on a claimable WoW:
 * Forever guild hub's Overview. Staff can view a hub without being a member, so
 * they never meet the join gate; this §4.7 neutral instruction callout (D3)
 * opens the gate's own Add character modal on this guild's roster (D4, D5).
 * After the modal closes the page (and the gate read under it) refetches: a
 * claim that conferred membership hides the banner via the widget probe; a new
 * character that did not shows the gate's not-linked warning instead (D7).
 */
import type { JSX } from 'react';
import { useIsFetching } from '@tanstack/react-query';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { Button } from '../../../components/ui/button';
import { guildPageKey } from '../../../components/hub/api/use-guild';
import { useGameRegistry } from '../../../hooks/use-game-registry';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { useJoinGate } from './use-join-gate';
import { useGateModal } from './use-join-gate-modal';
import { JoinGateClaimModal, NotLinkedWarning } from './join-gate-pieces';
import { useClaimBannerDismissed } from './use-wow-claim-banner';
import { CLAIM_BANNER_COPY as COPY } from './wow-claim-banner.helpers';

/** §4.7 neutral instruction callout; the right padding keeps the × clear of the copy and button. */
const CALLOUT_CLS = 'relative rounded-lg border border-edge bg-overlay/30 p-4 sm:pr-12';

/**
 * The × pinned to the callout's top-right corner. The wrapper is what is
 * positioned: `Button` carries its own `relative`, which would beat an
 * `absolute` passed in `className` and drop the × into the flow.
 */
function DismissCorner({ onDismiss }: { onDismiss: () => void }): JSX.Element {
    return (
        <div className="absolute right-1 top-1" data-testid="wow-claim-banner-dismiss">
            <Button iconOnly aria-label={COPY.dismiss} variant="ghost" size="sm" onClick={onDismiss}>
                <XMarkIcon className="h-4 w-4" aria-hidden="true" />
            </Button>
        </div>
    );
}

export interface WowClaimBannerViewProps {
    onClaim: () => void;
    onDismiss: () => void;
    /** A character arrived but the viewer is still not a member (D7). */
    showWarning: boolean;
}

/** The callout itself — copy, button, × and the not-linked warning; no data. */
export function WowClaimBannerView({ onClaim, onDismiss, showWarning }: WowClaimBannerViewProps): JSX.Element {
    // Phone stacks the copy over a full-width button; the copy reserves room for the × beside it.
    return (
        <section aria-label={COPY.label} data-testid="wow-claim-banner" className={CALLOUT_CLS}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <p className="min-w-0 flex-1 pr-10 text-sm text-foreground sm:pr-0">{COPY.line}</p>
                <Button onClick={onClaim} className="w-full sm:w-auto">{COPY.button}</Button>
            </div>
            {showWarning && <NotLinkedWarning className="mt-3 text-left" />}
            <DismissCorner onDismiss={onDismiss} />
        </section>
    );
}

/** The Overview widget body (`chrome: 'none'`); the probe has already decided it shows. */
export default function WowClaimBanner({ page }: HubWidgetCtx): JSX.Element {
    const guildId = page.guild.id;
    const gate = useJoinGate(guildId, page.viewer.isStaff === true);
    const modal = useGateModal(guildId, gate.data?.guild.gameId);
    // The modal preselects WoW: Forever by slug on open, so it waits for the registry.
    const registryLoading = useGameRegistry().isLoading;
    const pageFetching = useIsFetching({ queryKey: guildPageKey(guildId) }) > 0;
    const [, dismiss] = useClaimBannerDismissed(guildId);
    const notMember = gate.data?.viewer.isMember === false;
    return (
        <>
            <WowClaimBannerView
                onClaim={() => modal.open('roster')}
                onDismiss={dismiss}
                showWarning={modal.gained && notMember && !pageFetching}
            />
            {modal.tab !== null && modal.ready && !registryLoading && (
                <JoinGateClaimModal tab={modal.tab} guildId={guildId} onClose={modal.close} />
            )}
        </>
    );
}
