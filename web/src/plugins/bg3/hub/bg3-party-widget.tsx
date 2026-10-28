/**
 * ROK-1958 §3.1 — the BG3 hub Overview "Party" card body (order 42, span 2).
 * ONE snapshot query feeds it (D-14). States: loading pulse tiles; error +
 * retry; the D-10 empty states (no campaign / no saves / no active campaign);
 * else the subtitle, coverage strip (Q4), a 2-column tile grid (1 on phone)
 * and the "+N summon" line. Who may claim / remove: spec §3.4. Default export
 * so `register.ts` can `React.lazy` it.
 */
import { useState, type JSX } from 'react';
import type { Bg3CampaignSummary, Bg3HubCampaignsResponse, Bg3PartyClaim, Bg3Snapshot, Bg3SnapshotResponse } from '@raid-ledger/contract';
import { isOperatorOrAdmin, useAuth, type User } from '../../../hooks/use-auth';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { useBg3Campaigns, useBg3Snapshot } from '../hooks/use-bg3-hub';
import { useClaimBg3Slot, useUnclaimBg3Slot } from '../hooks/use-bg3-mutations';
import { bg3SummonsLine } from '../lib/bg3-labels';
import { Bg3PartyCoverage } from './bg3-party-coverage';
import { Bg3PartyDialogs, type Bg3PartyDialog } from './bg3-party-dialogs';
import { Bg3PartyEmpty, Bg3PartyError, type Bg3PartyEmptyKind } from './bg3-party-empty';
import { Bg3PartySlotTile } from './bg3-party-slot';

const PULSE = 'h-24 animate-pulse rounded-md bg-panel';

/** The claim the optimistic update paints for the viewer. */
function viewerClaim(user: User | null | undefined): Bg3PartyClaim {
    return {
        userId: user?.id ?? 0,
        displayName: user?.displayName ?? user?.username ?? 'You',
        avatarUrl: user?.resolvedAvatarUrl ?? user?.customAvatarUrl ?? null,
    };
}

function emptyKind(campaigns: Bg3HubCampaignsResponse, snap: Bg3SnapshotResponse | null): Bg3PartyEmptyKind | null {
    if (campaigns.campaigns.length === 0) return 'no-campaign';
    if (snap === null) return 'no-active';
    return snap.empty ? 'no-saves' : null;
}

interface PartyGridProps {
    readonly hubId: number;
    readonly snap: Bg3Snapshot;
    readonly campaign: Bg3CampaignSummary | undefined;
    readonly canEdit: boolean;
    readonly isMember: boolean;
}

function PartyGrid({ hubId, snap, campaign, canEdit, isMember }: PartyGridProps): JSX.Element {
    const { user } = useAuth();
    const viewerId = user?.id ?? null;
    const claim = useClaimBg3Slot(hubId, viewerClaim(user));
    const unclaim = useUnclaimBg3Slot(hubId);
    const members = snap.party.filter((s) => !s.isSummon);
    const hasClaim = viewerId !== null && members.some((s) => s.claim?.userId === viewerId);
    const canRemoveOthers = canEdit || isOperatorOrAdmin(user) || (viewerId !== null && campaign?.hostUserId === viewerId);
    const summons = bg3SummonsLine(snap.party);
    return (
        <div className="flex flex-col gap-3">
            <p className="text-xs text-muted">{campaign?.name ?? 'Campaign'} · {members.length} in party</p>
            <Bg3PartyCoverage party={snap.party} />
            <ul className="grid grid-cols-1 gap-2.5 md:grid-cols-2" aria-label="Party">
                {members.map((slot, i) => (
                    <Bg3PartySlotTile key={slot.slotKey ?? `slot-${i}`} slot={slot} viewerId={viewerId}
                        canClaim={isMember && viewerId !== null && !hasClaim} canRemoveOthers={canRemoveOthers}
                        onClaim={(slotKey) => claim.mutate({ campaignId: snap.campaignId, slotKey })}
                        onUnclaim={(slotKey) => unclaim.mutate({ campaignId: snap.campaignId, slotKey })} />
                ))}
            </ul>
            {summons !== null && <p className="text-xs text-muted" data-testid="bg3-party-summons">{summons}</p>}
        </div>
    );
}

export default function Bg3PartyWidget({ page }: HubWidgetCtx): JSX.Element {
    const hubId = page.guild.id;
    const campaigns = useBg3Campaigns(hubId);
    const snapshot = useBg3Snapshot(hubId);
    const [dialog, setDialog] = useState<Bg3PartyDialog>(null);
    if (campaigns.isPending || snapshot.isPending) {
        return <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2" data-testid="bg3-party-loading"><div className={PULSE} /><div className={PULSE} /></div>;
    }
    if (campaigns.isError || snapshot.isError) {
        return <Bg3PartyError onRetry={() => { void campaigns.refetch(); void snapshot.refetch(); }} />;
    }
    const snap = snapshot.data;
    const campaign = campaigns.data.campaigns.find((c) => c.id === snap?.campaignId);
    const kind = emptyKind(campaigns.data, snap);
    return (
        <>
            {snap === null || snap.empty || kind !== null
                ? <Bg3PartyEmpty kind={kind ?? 'no-active'} campaignName={campaign?.name ?? null} canEdit={campaigns.data.canEdit}
                    onStartCampaign={() => setDialog('start')} onAddSaves={() => setDialog('add-saves')} />
                : <PartyGrid hubId={hubId} snap={snap} campaign={campaign} canEdit={campaigns.data.canEdit}
                    isMember={page.viewer.role !== 'visitor'} />}
            <Bg3PartyDialogs open={dialog} onClose={() => setDialog(null)} hubId={hubId}
                campaignId={snap?.campaignId ?? null} campaignName={campaign?.name ?? null} />
        </>
    );
}
