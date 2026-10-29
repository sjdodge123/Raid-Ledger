/**
 * ROK-1958 §4.3 (1) — the Campaigns section: live rows (Active chip, saves ·
 * last saved, Archive for host/editors, "Make active" for editors), then a
 * collapsible "Archived (N)" with Unarchive. Host change is not in v1 (D-13).
 */
import type { JSX } from 'react';
import type { Bg3CampaignSummary, Bg3HubCampaignsResponse } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { StatusChip } from '../../../components/ui/status-chip';
import { ScrollCollapsible } from '../../../components/ui/scroll-collapsible';
import { syncedAgo } from '../../../lib/synced-ago';
import { useUpdateBg3Campaign, useUpdateBg3HubSettings } from '../hooks/use-bg3-mutations';
import { toastBg3CampaignError } from './bg3-campaign-toast';

export interface Bg3CampaignListProps {
    readonly hubId: number;
    readonly data: Bg3HubCampaignsResponse;
    readonly viewerId: number | null;
    readonly onArchive: (campaign: Bg3CampaignSummary) => void;
    /** `null` hides "Start a campaign" (non-member staff are view-only, Q9). */
    readonly onStart: (() => void) | null;
}

function metaLine(c: Bg3CampaignSummary): string {
    const saves = c.saveCount === 1 ? '1 save' : `${c.saveCount} saves`;
    return c.lastSavedAt === null ? saves : `${saves} · last saved ${syncedAgo(c.lastSavedAt)}`;
}

interface RowProps { readonly campaign: Bg3CampaignSummary; readonly active: boolean; readonly children?: JSX.Element | false }

function CampaignRow({ campaign, active, children }: RowProps): JSX.Element {
    return (
        <li className="flex flex-wrap items-center justify-between gap-2 py-3" data-testid="bg3-campaign-row">
            <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <span className="truncate">{campaign.name}</span>
                    {active && <StatusChip tone="success" title="The hub cards show this campaign">Active</StatusChip>}
                </p>
                <p className="text-xs text-muted">{metaLine(campaign)}</p>
            </div>
            {children && <div className="flex flex-wrap gap-2">{children}</div>}
        </li>
    );
}

function useCampaignActions(hubId: number) {
    const update = useUpdateBg3Campaign(hubId);
    const settings = useUpdateBg3HubSettings(hubId);
    return {
        makeActive: (id: number): void => settings.mutate({ activeCampaignId: id }, {
            onError: (err) => toastBg3CampaignError(err, "Couldn't change the active campaign."),
        }),
        unarchive: (id: number): void => update.mutate({ campaignId: id, body: { archived: false } }, {
            onError: (err) => toastBg3CampaignError(err, "Couldn't unarchive the campaign."),
        }),
    };
}

interface LiveProps {
    readonly data: Bg3HubCampaignsResponse;
    readonly live: readonly Bg3CampaignSummary[];
    readonly canArchive: (c: Bg3CampaignSummary) => boolean;
    readonly onArchive: (c: Bg3CampaignSummary) => void;
    readonly onMakeActive: (id: number) => void;
    /** Every campaign is archived → "No active campaign." instead of "…yet." */
    readonly allArchived: boolean;
}

function LiveCampaigns({ data, live, canArchive, onArchive, onMakeActive, allArchived }: LiveProps): JSX.Element {
    if (live.length === 0) {
        return <p className="text-sm text-muted">{allArchived ? 'No active campaign.' : 'No campaign on this hub yet.'}</p>;
    }
    return (
        <ul className="divide-y divide-edge" aria-label="Campaigns">
            {live.map((c) => {
                const active = c.id === data.settings.activeCampaignId;
                return (
                    <CampaignRow key={c.id} campaign={c} active={active}>
                        <>
                            {data.canEdit && !active && <Button variant="ghost" size="sm" onClick={() => onMakeActive(c.id)}>Make active</Button>}
                            {canArchive(c) && <Button variant="ghost" size="sm" onClick={() => onArchive(c)}>Archive</Button>}
                        </>
                    </CampaignRow>
                );
            })}
        </ul>
    );
}

export function Bg3CampaignList({ hubId, data, viewerId, onArchive, onStart }: Bg3CampaignListProps): JSX.Element {
    const actions = useCampaignActions(hubId);
    const canArchive = (c: Bg3CampaignSummary): boolean => data.canEdit || (viewerId !== null && c.hostUserId === viewerId);
    const live = data.campaigns.filter((c) => c.archivedAt === null);
    const archived = data.campaigns.filter((c) => c.archivedAt !== null);
    return (
        <div className="flex flex-col gap-3">
            <LiveCampaigns data={data} live={live} canArchive={canArchive} onArchive={onArchive} onMakeActive={actions.makeActive}
                allArchived={archived.length > 0} />
            {archived.length > 0 && (
                <ScrollCollapsible title={`Archived (${archived.length})`}>
                    <ul className="divide-y divide-edge" aria-label="Archived campaigns">
                        {archived.map((c) => (
                            <CampaignRow key={c.id} campaign={c} active={false}>
                                {canArchive(c) && <Button variant="ghost" size="sm" onClick={() => actions.unarchive(c.id)}>Unarchive</Button>}
                            </CampaignRow>
                        ))}
                    </ul>
                </ScrollCollapsible>
            )}
            {onStart && <div><Button variant="secondary" size="sm" onClick={onStart}>Start a campaign</Button></div>}
        </div>
    );
}
