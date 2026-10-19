/** ROK-1836 — owner chip + "updated" copy shared by the hub row and the page header. */
import { formatDistance } from 'date-fns';
import type {
    ValheimCharacterOwner,
    ValheimCharacterSummary,
    ValheimClaimEvent,
} from '@raid-ledger/contract';
import type { StatusChipTone } from '../../../components/ui/status-chip';

export interface OwnerChip {
    tone: StatusChipTone;
    label: string;
    title: string;
}

/** Unclaimed (warning) · Claimed · Assigned by an admin (neutral) — colour is never the only signal. */
export function ownerChip(
    c: Pick<ValheimCharacterSummary, 'claimedBy' | 'claimSource'>,
): OwnerChip {
    if (c.claimedBy === null)
        return {
            tone: 'warning',
            label: 'Unclaimed',
            title: 'No one has claimed this character yet',
        };
    if (c.claimSource === 'admin') {
        return {
            tone: 'neutral',
            label: 'Assigned by an admin',
            title: 'An admin set this owner',
        };
    }
    return {
        tone: 'neutral',
        label: 'Claimed',
        title: 'The owner claimed this character',
    };
}

/** "Updated 3 hours ago" from the snapshot's `capturedAt`. */
export function updatedAgo(capturedAt: string, now: Date = new Date()): string {
    const at = new Date(capturedAt);
    if (Number.isNaN(at.getTime()) || at > now) return 'Updated just now';
    return `Updated ${formatDistance(at, now, { addSuffix: true })}`;
}

type MaybeUser = ValheimCharacterOwner | null | undefined;

function byActor(actor: MaybeUser): string {
    return actor ? ` by ${actor.username}` : '';
}

/**
 * The claim-history wording from the approved prototype ("Assigned to X by Y"),
 * degrading to the generic copy when the API did not resolve a user.
 */
export function claimEventLabel(event: ValheimClaimEvent): string {
    const { toUser, fromUser, actor } = event;
    switch (event.action) {
        case 'claim':
            return `Claimed by ${toUser ? toUser.username : 'a member'}`;
        case 'admin_assign':
            return toUser
                ? `Assigned to ${toUser.username}${byActor(actor)}`
                : 'Assigned by an admin';
        case 'admin_unassign':
            return fromUser
                ? `Owner removed from ${fromUser.username}${byActor(actor)}`
                : 'Owner removed by an admin';
        case 'auto_attach':
            return toUser
                ? `Matched ${toUser.username} by Steam ID`
                : 'Matched by Steam ID';
        case 'auto_detach':
            return `Steam match removed${fromUser ? ` from ${fromUser.username}` : ''}`;
    }
}

/** "3 hours ago" for a history row; a bad or future timestamp reads "just now". */
export function claimEventAgo(createdAt: string, now: Date = new Date()): string {
    const at = new Date(createdAt);
    if (Number.isNaN(at.getTime()) || at > now) return 'just now';
    return formatDistance(at, now, { addSuffix: true });
}
