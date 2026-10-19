/** ROK-1836 — owner chip + "updated" copy shared by the hub row and the page header. */
import { formatDistance } from 'date-fns';
import type { ValheimCharacterSummary } from '@raid-ledger/contract';
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
