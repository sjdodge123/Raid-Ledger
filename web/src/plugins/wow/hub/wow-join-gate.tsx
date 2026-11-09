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
import { useCallback, useEffect, useState, type JSX } from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import type { WowGuildJoinGateDto } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { DialogBanner } from '../../../components/ui/dialog-banner';
import { HubCrest } from '../../../components/hub/crest/hub-crest';
import { hubCopy } from '../../../components/hub/hub-copy';
import { guildPageKey } from '../../../components/hub/api/use-guild';
import { AddCharacterModal } from '../../../components/profile/AddCharacterModal';
import { useMyCharacters } from '../../../hooks/use-characters';
import { useGameRegistry } from '../../../hooks/use-game-registry';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import { useJoinGate } from './use-join-gate';
import {
    CLAIM_PARAM, CLAIM_ROSTER, IMPORT_ARMORY_LABEL, JOIN_GATE_LINE, NOT_LINKED_WARNING, NOT_ON_ROSTER_BODY,
    NOT_ON_ROSTER_LEAD, PICK_CHARACTER_LABEL, gainedCharacter, joinGateMeta, memberCountLabel,
} from './wow-join-gate.helpers';

type GateTab = 'roster' | 'import';

/**
 * The Add character modal's state, plus whether a character arrived since the
 * viewer's characters first loaded. The baseline is taken on that first load,
 * not at open: on the `?claim=roster` landing (or a fast click) the modal opens
 * before the list has arrived, and an open-time baseline would never be set.
 */
function useGateModal(guildId: number, gameId: number | undefined) {
    const queryClient = useQueryClient();
    const chars = useMyCharacters(gameId, gameId !== undefined);
    const [tab, setTab] = useState<GateTab | null>(null);
    const [baseline, setBaseline] = useState<ReadonlySet<string> | null>(null);
    const current = chars.data?.data;
    // Adjust-state-during-render: record the first loaded list exactly once.
    if (baseline === null && current !== undefined) setBaseline(new Set(current.map((c) => c.id)));
    const open = useCallback((next: GateTab) => setTab(next), []);
    const close = useCallback(() => {
        setTab(null);
        void queryClient.invalidateQueries({ queryKey: ['me', 'characters'] });
        void queryClient.invalidateQueries({ queryKey: guildPageKey(guildId) });
    }, [queryClient, guildId]);
    return { tab, open, close, gained: tab === null && gainedCharacter(baseline, current) };
}

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

function NotLinkedWarning(): JSX.Element {
    return (
        <div className="mx-auto max-w-md text-left">
            <DialogBanner tone="warning" role="status" testId="wow-join-gate-warning">{NOT_LINKED_WARNING}</DialogBanner>
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
            {modal.tab !== null && !registryLoading && (
                <AddCharacterModal isOpen onClose={modal.close} gameSlug={WOW_FOREVER_GAME_SLUG} initialTab={modal.tab} rosterGuildId={guild.id} />
            )}
        </div>
    );
}
