/**
 * ROK-1893 P1 — the shared pieces of the invite UI: one link row (expiry ·
 * joined count · Revoke when the viewer may) and the "make a link" row
 * (expiry Select + Create, or the cap message). Tokens only.
 */
import { useState, type JSX } from 'react';
import type { HubInvite, HubInviteList } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { Select } from '../../ui/select';
import { useCreateHubInvite, useRevokeHubInvite } from './hub-invites-api';
import {
    DEFAULT_EXPIRY, EXPIRY_OPTIONS, createDto, expiryLabel, isExpiryChoice, usesLabel, type ExpiryChoice,
} from './community-invite-helpers';

export function InviteRows({ hubId, items, showMaker }: { hubId: number; items: HubInvite[]; showMaker: boolean }): JSX.Element {
    const revoke = useRevokeHubInvite(hubId);
    const [now] = useState(() => Date.now());
    return (
        <ul className="divide-y divide-edge-subtle rounded-lg border border-edge">
            {items.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm" data-testid="hub-invite-row">
                    <span className="min-w-0 text-secondary">
                        {showMaker && <span className="font-medium text-foreground">{inv.createdBy?.displayName ?? 'Former member'} · </span>}
                        {expiryLabel(inv.expiresAt, now)} · {usesLabel(inv)}
                    </span>
                    {inv.canRevoke && (
                        <Button variant="ghost" size="sm" disabled={revoke.isPending} data-testid="hub-invite-revoke"
                            onClick={() => revoke.mutate(inv.id)}>Revoke</Button>
                    )}
                </li>
            ))}
        </ul>
    );
}

/** Expiry choice + Create; at the per-member cap, the "Revoke one" line instead (§8d). */
export function CreateInviteRow({ hubId, list }: { hubId: number; list: HubInviteList }): JSX.Element {
    const create = useCreateHubInvite(hubId);
    const [expiry, setExpiry] = useState<ExpiryChoice>(DEFAULT_EXPIRY);
    if (list.liveByViewer >= list.perMemberCap) {
        return (
            <p className="text-sm text-secondary" data-testid="hub-invite-cap">
                You have {list.perMemberCap} live links. Revoke one to make another.
            </p>
        );
    }
    return (
        <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-secondary">
                Expires after
                <Select fieldSize="sm" value={expiry} data-testid="hub-invite-expiry"
                    onChange={(e) => { if (isExpiryChoice(e.target.value)) setExpiry(e.target.value); }}>
                    {EXPIRY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
            </label>
            <Button size="sm" disabled={create.isPending} data-testid="hub-invite-create"
                onClick={() => create.mutate(createDto(expiry))}>Create link</Button>
        </div>
    );
}
