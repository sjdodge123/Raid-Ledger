/**
 * ROK-1958 D-3 / §4.3 — the BG3 "Campaign" game tab: Campaigns, Your saves,
 * Hub settings (editors/staff). Members start campaigns and file their own
 * saves; editors switch the active campaign and the spoiler setting.
 * Non-member staff are view-only (Q9): no Start a campaign, no Your saves. History
 * (§4.3 (3)) lists the active campaign's sessions after "Your saves".
 */
import { useState, type JSX, type ReactNode } from 'react';
import type { Bg3CampaignSummary, Bg3HubCampaignsResponse } from '@raid-ledger/contract';
import type { HubCtx } from '../../hub-module';
import { Button } from '../../../components/ui/button';
import { useAuth } from '../../../hooks/use-auth';
import { useBg3Campaigns, useBg3MyUnassignedSaves } from '../hooks/use-bg3-hub';
import { useSetBg3DefaultCampaign } from '../hooks/use-bg3-mutations';
import { Bg3CampaignList } from './bg3-campaign-list';
import { Bg3EditorSection } from './bg3-editor-section';
import { Bg3CampaignPicker } from './bg3-campaign-picker';
import { Bg3StartCampaignDialog } from './bg3-start-campaign-dialog';
import { Bg3AddSavesSheet } from './bg3-add-saves-sheet';
import { Bg3ArchiveConfirm } from './bg3-archive-confirm';
import { toastBg3CampaignError } from './bg3-campaign-toast';
import { Bg3CampaignHistory } from './bg3-campaign-history';
import { isBg3HubMember } from '../lib/bg3-membership';

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
    return (
        <section className="flex flex-col gap-3 rounded-lg border border-edge bg-surface p-4">
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            {children}
        </section>
    );
}

/** `capped`: the page walk hit its safety stop, so `n` is a floor ("2000+"), not an exact count. */
function unassignedLine(n: number, capped: boolean): string {
    if (capped) return `${n}+ of your saves aren't in a campaign.`;
    if (n === 0) return 'All your saves are in a campaign.';
    return n === 1 ? "1 of your saves isn't in a campaign." : `${n} of your saves aren't in a campaign.`;
}

interface YourSavesProps { hubId: number; data: Bg3HubCampaignsResponse; onAddSaves: () => void; onStart: () => void }

function YourSaves({ hubId, data, onAddSaves, onStart }: YourSavesProps): JSX.Element {
    const mine = useBg3MyUnassignedSaves();
    const setDefault = useSetBg3DefaultCampaign(hubId);
    const unassigned = (mine.data?.saves ?? []).filter((s) => s.campaignId === null).length;
    const hasActive = data.settings.activeCampaignId !== null;
    return (
        <Section title="Your saves">
            <p className="text-sm text-secondary">{unassignedLine(unassigned, (mine.data?.nextCursor ?? null) !== null)}</p>
            <div><Button variant="secondary" size="sm" onClick={onAddSaves} disabled={!hasActive || unassigned === 0}>Add my saves</Button></div>
            <label className="flex flex-col gap-1 text-sm text-secondary">
                New saves go to:
                <Bg3CampaignPicker campaigns={data.campaigns} value={mine.data?.defaultCampaignId ?? null} noneLabel="No campaign"
                    onNewCampaign={onStart} disabled={mine.isLoading}
                    onChange={(id) => setDefault.mutate(id, { onError: (e) => toastBg3CampaignError(e, "Couldn't change where new saves go.") })} />
            </label>
        </Section>
    );
}

type Dialog = 'start' | 'add-saves' | null;

export function Bg3CampaignTab({ page }: HubCtx): JSX.Element | null {
    const hubId = page.guild.id;
    const campaigns = useBg3Campaigns(hubId);
    const { user } = useAuth();
    const [dialog, setDialog] = useState<Dialog>(null);
    const [archiving, setArchiving] = useState<Bg3CampaignSummary | null>(null);
    if (campaigns.isLoading) return null;
    if (!campaigns.data) return <p className="py-12 text-center text-sm text-muted">Couldn't load this hub's campaigns.</p>;
    const data = campaigns.data;
    const active = data.campaigns.find((c) => c.id === data.settings.activeCampaignId) ?? null;
    const close = (): void => setDialog(null);
    const member = isBg3HubMember(page);
    return (
        <div className="flex flex-col gap-4" data-testid="bg3-campaign-tab">
            <Section title="Campaigns">
                <Bg3CampaignList hubId={hubId} data={data} viewerId={user?.id ?? null}
                    onArchive={setArchiving} onStart={member ? () => setDialog('start') : null} />
            </Section>
            {member && <YourSaves hubId={hubId} data={data} onAddSaves={() => setDialog('add-saves')} onStart={() => setDialog('start')} />}
            {active && <Section title="History"><Bg3CampaignHistory hubId={hubId} campaignId={active.id} /></Section>}
            {data.canEdit && <div className="rounded-lg border border-edge bg-surface p-4"><Bg3EditorSection hubId={hubId} data={data} /></div>}
            <Bg3StartCampaignDialog isOpen={dialog === 'start'} hubId={hubId} onClose={close} />
            {active && <Bg3AddSavesSheet isOpen={dialog === 'add-saves'} hubId={hubId} campaignId={active.id}
                campaignName={active.name} onClose={close} />}
            <Bg3ArchiveConfirm hubId={hubId} campaign={archiving} onClose={() => setArchiving(null)} />
        </div>
    );
}

export default Bg3CampaignTab;
