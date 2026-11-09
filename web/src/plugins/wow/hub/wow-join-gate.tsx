/**
 * ROK-2132 — what a non-member sees on a WoW: Forever guild hub instead of the
 * 403 notice: a §4.5 empty state with a crest header (approved wireframe A)
 * and the two ways in — claim a roster row, or import from the Armory. Core
 * renders it through the `wow_guild` module's `nonMemberGate`.
 *
 * Shows only the gate read's facts (Ruling 1). A guild the gate refuses
 * (Retail/Classic, hidden) keeps today's not-a-member notice (AC 7). After the
 * modal closes the page is invalidated, so a claim that conferred membership
 * lands on the page (AC 4); if a new character arrived but the page still
 * 403s, a warning banner says so instead of looping (AC 8).
 */
import { useEffect, type JSX } from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import type { WowGuildJoinGateDto } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { HubCrest } from '../../../components/hub/crest/hub-crest';
import { hubCopy } from '../../../components/hub/hub-copy';
import { guildPageKey } from '../../../components/hub/api/use-guild';
import { useGameRegistry } from '../../../hooks/use-game-registry';
import { useJoinGate } from './use-join-gate';
import { useGateModal, type GateTab } from './use-join-gate-modal';
import { JoinGateClaimModal, NotLinkedWarning } from './join-gate-pieces';
import {
    CLAIM_PARAM, CLAIM_ROSTER, IMPORT_ARMORY_LABEL, JOIN_GATE_LINE, NOT_ON_ROSTER_BODY,
    NOT_ON_ROSTER_LEAD, PICK_CHARACTER_LABEL, joinGateMeta, memberCountLabel,
} from './wow-join-gate.helpers';

/** `?claim=roster` (the directory card's landing) opens the roster tab once, then leaves the URL (Ruling 9). */
function useClaimParam(ready: boolean, open: (tab: GateTab) => void): void {
    const [params, setParams] = useSearchParams();
    const wanted = params.get(CLAIM_PARAM) === CLAIM_ROSTER;
    useEffect(() => {
        if (!ready || !wanted) return;
        open('roster');
        setParams((prev) => {
            const next = new URLSearchParams(prev);
            next.delete(CLAIM_PARAM);
            return next;
        }, { replace: true });
    }, [ready, wanted, open, setParams]);
}

/** Claimed in another tab: re-ask for the page, which now renders. */
function useMemberSkip(guildId: number, isMember: boolean): void {
    const queryClient = useQueryClient();
    useEffect(() => {
        if (isMember) void queryClient.invalidateQueries({ queryKey: guildPageKey(guildId) });
    }, [isMember, guildId, queryClient]);
}

function GateHeader({ guild }: { guild: WowGuildJoinGateDto['guild'] }): JSX.Element {
    return (
        <>
            <HubCrest crest={guild.crest} name={guild.name} size="hero" className="mx-auto mb-3" />
            <h1 className="text-xl font-semibold text-foreground">{guild.name}</h1>
            <p className="mt-0.5 text-sm text-muted">
                <span>{joinGateMeta(guild)}</span>
                <span className="block sm:inline"><span className="hidden sm:inline"> · </span>{memberCountLabel(guild.memberCount)}</span>
            </p>
        </>
    );
}

function NotOnRosterHint(): JSX.Element {
    return (
        <div data-testid="wow-join-gate-hint" className="mx-auto mt-5 max-w-md rounded-lg border border-edge bg-overlay/30 p-4 text-left text-sm text-secondary">
            <span className="font-semibold text-foreground">{NOT_ON_ROSTER_LEAD}</span> {NOT_ON_ROSTER_BODY}
        </div>
    );
}

/** The gate read is in flight — a crest-and-title placeholder rather than an empty page. */
function GateLoading(): JSX.Element {
    return (
        <div aria-busy="true" data-testid="wow-join-gate-loading" className="py-12">
            <div className="mx-auto mb-3 h-20 w-20 animate-pulse rounded-full border border-edge bg-panel" />
            <div className="mx-auto mb-2 h-6 w-48 animate-pulse rounded bg-panel" />
            <div className="mx-auto h-4 w-64 animate-pulse rounded bg-surface" />
        </div>
    );
}

export function WowJoinGate({ guildId }: { guildId: number }): JSX.Element {
    const gate = useJoinGate(guildId);
    const guild = gate.data?.guild;
    const modal = useGateModal(guildId, guild?.gameId);
    // The modal preselects WoW: Forever by slug on open, so it waits for the registry (else no game, no WoW tabs).
    const registryLoading = useGameRegistry().isLoading;
    const pageFetching = useIsFetching({ queryKey: guildPageKey(guildId) }) > 0;
    useClaimParam(guild !== undefined, modal.open);
    useMemberSkip(guildId, gate.data?.viewer.isMember === true);
    if (gate.error) {
        return <div data-testid="guild-not-member" className="py-12 text-center"><p className="text-sm text-muted">{hubCopy('wow_guild').notMember}</p></div>;
    }
    if (!gate.data || !guild) return <GateLoading />;
    return (
        <div data-testid="wow-join-gate" className="py-12 text-center">
            {modal.gained && !pageFetching && <NotLinkedWarning />}
            <GateHeader guild={guild} />
            <p className="mx-auto mb-5 mt-4 max-w-md text-secondary">{JOIN_GATE_LINE}</p>
            <div className="flex flex-col justify-center gap-2 sm:flex-row">
                <Button onClick={() => modal.open('roster')} className="w-full sm:w-auto">{PICK_CHARACTER_LABEL}</Button>
                <Button variant="secondary" onClick={() => modal.open('import')} className="w-full sm:w-auto">{IMPORT_ARMORY_LABEL}</Button>
            </div>
            {gate.data.viewer.hasForeverCharacter && <NotOnRosterHint />}
            {modal.tab !== null && modal.ready && !registryLoading && (
                <JoinGateClaimModal tab={modal.tab} guildId={guild.id} onClose={modal.close} />
            )}
        </div>
    );
}
