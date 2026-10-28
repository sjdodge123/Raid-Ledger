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
    readonly onStart: () => void;
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

export function Bg3CampaignList({ hubId, data, viewerId, onArchive, onStart }: Bg3CampaignListProps): JSX.Element {
    const update = useUpdateBg3Campaign(hubId);
    const settings = useUpdateBg3HubSettings(hubId);
    const canArchive = (c: Bg3CampaignSummary): boolean => data.canEdit || (viewerId !== null && c.hostUserId === viewerId);
    const live = data.campaigns.filter((c) => c.archivedAt === null);
    const archived = data.campaigns.filter((c) => c.archivedAt !== null);
    const makeActive = (id: number): void => settings.mutate({ activeCampaignId: id }, {
        onError: (err) => toastBg3CampaignError(err, "Couldn't change the active campaign."),
    });
    const unarchive = (id: number): void => update.mutate({ campaignId: id, body: { archived: false } }, {
        onError: (err) => toastBg3CampaignError(err, "Couldn't unarchive the campaign."),
    });
    return (
        <div className="flex flex-col gap-3">
            {live.length === 0 ? <p className="text-sm text-muted">No campaign on this hub yet.</p> : (
                <ul className="divide-y divide-edge" aria-label="Campaigns">
                    {live.map((c) => {
                        const active = c.id === data.settings.activeCampaignId;
                        return (
                            <CampaignRow key={c.id} campaign={c} active={active}>
                                <>
                                    {data.canEdit && !active && <Button variant="ghost" size="sm" onClick={() => makeActive(c.id)}>Make active</Button>}
                                    {canArchive(c) && <Button variant="ghost" size="sm" onClick={() => onArchive(c)}>Archive</Button>}
                                </>
                            </CampaignRow>
                        );
                    })}
                </ul>
            )}
            {archived.length > 0 && (
                <ScrollCollapsible title={`Archived (${archived.length})`}>
                    <ul className="divide-y divide-edge" aria-label="Archived campaigns">
                        {archived.map((c) => (
                            <CampaignRow key={c.id} campaign={c} active={false}>
                                {canArchive(c) && <Button variant="ghost" size="sm" onClick={() => unarchive(c.id)}>Unarchive</Button>}
                            </CampaignRow>
                        ))}
                    </ul>
                </ScrollCollapsible>
            )}
            <div><Button variant="secondary" size="sm" onClick={onStart}>Start a campaign</Button></div>
        </div>
    );
}
