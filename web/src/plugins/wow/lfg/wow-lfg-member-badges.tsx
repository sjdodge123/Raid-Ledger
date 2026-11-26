/**
 * ROK-2352 §3 — per-member WoW badges on the group roster: the character name
 * (when one was picked) and one pill per role. Reads `member.pluginDetail`
 * (the api's `WowLfgMemberDetailDto`); renders nothing without a valid one.
 * A hand raised from Discord has empty roles → "Role not set".
 */
import type { JSX } from 'react';
import { WowLfgMemberDetailSchema } from '@raid-ledger/contract';
import type { LfgMemberBadgesProps } from '../../lfg-grouping';
import { StatusChip } from '../../../components/ui/status-chip';
import { WOW_LFG_COPY } from './wow-lfg-copy';

export function WowLfgMemberBadges({ member }: LfgMemberBadgesProps): JSX.Element | null {
    const parsed = WowLfgMemberDetailSchema.safeParse(member.pluginDetail);
    if (!parsed.success) return null;
    const { roles, characterName } = parsed.data;
    return (
        <span data-testid="wow-lfg-member-badges" className="flex min-w-0 flex-wrap items-center gap-1">
            {characterName ? <span className="truncate text-xs text-muted">{characterName}</span> : null}
            {roles.length === 0 ? (
                <StatusChip tone="neutral" title={WOW_LFG_COPY.roleNotSet}>{WOW_LFG_COPY.roleNotSet}</StatusChip>
            ) : (
                roles.map((role) => (
                    <StatusChip key={role} tone="neutral" title={`Role: ${role}`}>{role}</StatusChip>
                ))
            )}
        </span>
    );
}
