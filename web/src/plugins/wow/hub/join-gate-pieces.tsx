/**
 * ROK-2132 / ROK-2151 D5 — pieces shared by the non-member join gate and the
 * staff "Claim your character" banner, so there is one claim UI: the AC 8
 * "character not linked to this guild" warning and the Add character modal
 * mount (WoW: Forever, filtered to this guild's roster).
 */
import type { JSX } from 'react';
import { DialogBanner } from '../../../components/ui/dialog-banner';
import { AddCharacterModal } from '../../../components/profile/AddCharacterModal';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import { NOT_LINKED_WARNING } from './wow-join-gate.helpers';
import type { GateTab } from './use-join-gate-modal';

/** A character arrived but the viewer is still not a member — said instead of looping. */
export function NotLinkedWarning({ className = 'mx-auto max-w-md text-left' }: { className?: string }): JSX.Element {
    return (
        <div className={className}>
            <DialogBanner tone="warning" role="status" testId="wow-join-gate-warning">{NOT_LINKED_WARNING}</DialogBanner>
        </div>
    );
}

export interface JoinGateClaimModalProps {
    tab: GateTab;
    guildId: number;
    onClose: () => void;
}

/** Add character, opened on `tab`; the roster tab lists only this guild's rows. */
export function JoinGateClaimModal({ tab, guildId, onClose }: JoinGateClaimModalProps): JSX.Element {
    return <AddCharacterModal isOpen onClose={onClose} gameSlug={WOW_FOREVER_GAME_SLUG} initialTab={tab} rosterGuildId={guildId} />;
}
