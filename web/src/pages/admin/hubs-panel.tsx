/**
 * ROK-1870 — Admin → Hubs (`/admin/settings/general/hubs`). Tabs: Pending (N)
 * proposals to approve or reject, Active hubs (transfer leader, archive) and
 * Archived hubs (restore). "Create hub" makes an active hub directly.
 */
import { useState, type JSX, type ReactNode } from 'react';
import type { HubProposal } from '@raid-ledger/contract';
import { TabRow } from '../../components/ui/tab-row';
import { useHashTab } from '../../components/ui/tab-row.helpers';
import { Button } from '../../components/ui/button';
import { LoadingSpinner } from '../../components/ui/loading-spinner';
import { useAdminHubList, useAdminHubProposals, useSetHubStatus, type AdminHubEntry, type AdminHubTab } from './use-admin-hubs';
import { ActiveHubRow, ArchivedHubRow, PendingHubRow } from './hubs-panel-rows';
import { ApproveHubDialog, RejectHubDialog, TransferLeaderDialog } from './hubs-panel-dialogs';
import { CreateHubDialog } from './hubs-create-dialog';

const TAB_IDS: readonly AdminHubTab[] = ['pending', 'active', 'archived'];

/** Loading / error / empty states around a row list. */
function ListState({ loading, error, empty, emptyText, children }: {
    loading: boolean; error: Error | null; empty: boolean; emptyText: string; children: ReactNode;
}): JSX.Element {
    if (loading) return <LoadingSpinner />;
    if (error) return <p role="alert" className="text-sm text-danger">{error.message}</p>;
    if (empty) return <p className="text-sm text-secondary">{emptyText}</p>;
    return <ul className="space-y-3">{children}</ul>;
}

function PendingList(): JSX.Element {
    const q = useAdminHubProposals();
    const [approving, setApproving] = useState<HubProposal | null>(null);
    const [rejecting, setRejecting] = useState<HubProposal | null>(null);
    const items = q.data?.items ?? [];
    return (
        <>
            <ListState loading={q.isLoading} error={q.error} empty={items.length === 0} emptyText="No proposals waiting for review.">
                {items.map((p) => <PendingHubRow key={p.id} proposal={p} onApprove={setApproving} onReject={setRejecting} />)}
            </ListState>
            {approving ? <ApproveHubDialog proposal={approving} onClose={() => setApproving(null)} /> : null}
            {rejecting ? <RejectHubDialog proposal={rejecting} onClose={() => setRejecting(null)} /> : null}
        </>
    );
}

function HubList({ status }: { status: 'active' | 'archived' }): JSX.Element {
    const q = useAdminHubList(status);
    const setStatus = useSetHubStatus();
    const [transferring, setTransferring] = useState<AdminHubEntry | null>(null);
    const items = q.data?.items ?? [];
    const busy = (h: AdminHubEntry): boolean => setStatus.isPending && setStatus.variables?.hubId === h.id;
    const row = (h: AdminHubEntry): JSX.Element => status === 'active'
        ? <ActiveHubRow key={h.id} hub={h} busy={busy(h)} onTransfer={setTransferring}
            onArchive={() => setStatus.mutate({ hubId: h.id, status: 'archived' })} />
        : <ArchivedHubRow key={h.id} hub={h} busy={busy(h)} onRestore={() => setStatus.mutate({ hubId: h.id, status: 'active' })} />;
    return (
        <>
            {setStatus.error ? <p role="alert" className="mb-3 text-sm text-danger">{setStatus.error.message}</p> : null}
            <ListState loading={q.isLoading} error={q.error} empty={items.length === 0}
                emptyText={status === 'active' ? 'No active hubs yet.' : 'No archived hubs.'}>
                {items.map(row)}
            </ListState>
            {transferring ? <TransferLeaderDialog hub={transferring} onClose={() => setTransferring(null)} /> : null}
        </>
    );
}

/** The Admin → Hubs panel. */
export function HubsPanel(): JSX.Element {
    const [tab] = useHashTab(TAB_IDS, 'pending');
    const [creating, setCreating] = useState(false);
    const pending = useAdminHubProposals().data?.items.length;
    const tabs = [
        { id: 'pending', label: pending === undefined ? 'Pending' : `Pending (${pending})` },
        { id: 'active', label: 'Active' },
        { id: 'archived', label: 'Archived' },
    ];
    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="text-xl font-semibold text-foreground">Hubs</h2>
                    <p className="text-sm text-secondary">Review proposed community hubs and manage existing ones.</p>
                </div>
                <Button variant="primary" onClick={() => setCreating(true)}>Create hub</Button>
            </div>
            <TabRow tabs={tabs} activeId={tab} label="Hub queue sections" />
            {tab === 'pending' ? <PendingList /> : <HubList key={tab} status={tab === 'archived' ? 'archived' : 'active'} />}
            {creating ? <CreateHubDialog onClose={() => setCreating(false)} /> : null}
        </div>
    );
}

export default HubsPanel;
