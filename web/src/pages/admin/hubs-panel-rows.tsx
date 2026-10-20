/**
 * ROK-1870 — one row per tab of Admin → Hubs. Rows are stacked cards on a
 * phone and a single line from `sm` up; actions sit at the row's end.
 */
import type { JSX, ReactNode } from 'react';
import type { HubProposal } from '@raid-ledger/contract';
import { Button } from '../../components/ui/button';
import { AvatarWithFallback } from '../../components/shared/AvatarWithFallback';
import type { AdminHubEntry } from './use-admin-hubs';

const ROW = 'flex flex-col gap-3 rounded-lg border border-edge bg-panel p-4 sm:flex-row sm:items-center sm:justify-between';

function RowShell({ title, meta, children }: { title: string; meta: ReactNode; children: ReactNode }): JSX.Element {
    return (
        <li className={ROW}>
            <div className="min-w-0 space-y-1">
                <p className="font-semibold text-foreground">{title}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-secondary">{meta}</div>
            </div>
            <div className="flex flex-wrap gap-2">{children}</div>
        </li>
    );
}

/** Days since an ISO date, as "today" / "N days ago". */
function relative(iso: string): string {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    if (days <= 0) return 'today';
    return days === 1 ? '1 day ago' : `${days} days ago`;
}

export interface PendingRowProps {
    proposal: HubProposal;
    onApprove: (p: HubProposal) => void;
    onReject: (p: HubProposal) => void;
}

/** A proposal awaiting review. */
export function PendingHubRow({ proposal: p, onApprove, onReject }: PendingRowProps): JSX.Element {
    const meta = (
        <>
            <span>{p.gameName}</span>
            <span className="inline-flex items-center gap-1.5">
                <AvatarWithFallback avatarUrl={p.proposedBy.avatarUrl} username={p.proposedBy.username} sizeClassName="h-5 w-5" />
                <span>{p.proposedBy.username}</span>
            </span>
            <span>{relative(p.createdAt)}</span>
            <span className="basis-full text-foreground">{p.blurb}</span>
        </>
    );
    return (
        <RowShell title={p.name} meta={meta}>
            <Button variant="success-soft" size="sm" onClick={() => onApprove(p)}>Approve</Button>
            <Button variant="destructive-soft" size="sm" onClick={() => onReject(p)}>Reject</Button>
        </RowShell>
    );
}

export interface ActiveRowProps {
    hub: AdminHubEntry;
    onTransfer: (h: AdminHubEntry) => void;
    onArchive: (h: AdminHubEntry) => void;
    busy: boolean;
}

/** An active hub: leader (or a "No leader" warning), members, actions. */
export function ActiveHubRow({ hub, onTransfer, onArchive, busy }: ActiveRowProps): JSX.Element {
    const leader = hub.leaderless || !hub.leaderName
        ? <span className="font-medium text-warning">No leader</span>
        : <span>Leader: {hub.leaderName}</span>;
    const meta = (
        <>
            <span>{hub.gameName}</span>
            {leader}
            <span>{hub.memberCount} {hub.memberCount === 1 ? 'member' : 'members'}</span>
            {hub.createdAt ? <span>Created {relative(hub.createdAt)}</span> : null}
        </>
    );
    return (
        <RowShell title={hub.name} meta={meta}>
            <Button variant="secondary" size="sm" onClick={() => onTransfer(hub)}>Transfer leader</Button>
            <Button variant="warning-soft" size="sm" loading={busy} onClick={() => onArchive(hub)}>Archive</Button>
        </RowShell>
    );
}

export interface ArchivedRowProps {
    hub: AdminHubEntry;
    onRestore: (h: AdminHubEntry) => void;
    busy: boolean;
}

/** An archived hub with a Restore action. */
export function ArchivedHubRow({ hub, onRestore, busy }: ArchivedRowProps): JSX.Element {
    const meta = (
        <>
            <span>{hub.gameName}</span>
            <span>{hub.memberCount} {hub.memberCount === 1 ? 'member' : 'members'}</span>
        </>
    );
    return (
        <RowShell title={hub.name} meta={meta}>
            <Button variant="secondary" size="sm" loading={busy} onClick={() => onRestore(hub)}>Restore</Button>
        </RowShell>
    );
}
