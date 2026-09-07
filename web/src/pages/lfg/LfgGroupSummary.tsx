/**
 * The left half of the LFG status bar: the headline count, the two lines that
 * describe the group's horizon, and the roster avatars.
 *
 * Split out of `LfgStatusBar.tsx` (ROK-1479) purely for the file budget — the
 * bar gained the urgency choice and the now strip, and this is the half that
 * has no behaviour to speak of.
 */
import type { JSX } from 'react';
import type { LfgGroupDetailDto, LfgMemberDto } from '@raid-ledger/contract';
import { MemberAvatarGroup } from '../../components/lineups/decided/MemberAvatarGroup';
import { nowLine } from '../../components/lfg/lfg-chip-copy';
import { LFG_COPY, lookingLine } from './lfg-copy';

/**
 * `LfgMemberDto.avatarUrl` is already resolved server-side
 * (`customAvatarUrl ?? avatar`), so route an absolute URL through the Discord
 * slot and a relative upload path through the custom slot.
 */
function toAvatarMember(member: LfgMemberDto) {
    const absolute = member.avatarUrl?.startsWith('http') === true;
    return {
        userId: member.userId,
        displayName: member.displayName ?? member.username,
        avatar: absolute ? member.avatarUrl : null,
        discordId: null,
        customAvatarUrl: absolute ? null : member.avatarUrl,
    };
}

/**
 * ROK-1479 A7 — the headline count of people who want to play RIGHT NOW.
 *
 * Sits under the weekly `lookingLine` rather than replacing it: `activeCount`
 * still counts both urgencies (contract D2), so the two lines describe the
 * same group at two horizons and neither is redundant.
 *
 * @param nowCount - `now` intents on the game.
 */
function NowCountLine({ nowCount }: { nowCount: number }): JSX.Element | null {
    if (nowCount <= 0) return null;
    return (
        <p
            data-testid="lfg-status-now-count"
            className="text-xs font-semibold text-amber-400"
        >
            {nowLine(nowCount)}
        </p>
    );
}

/**
 * Count + label + roster avatars.
 *
 * @param props.group - The group whose headline this is.
 */
export function GroupSummary({ group }: { group: LfgGroupDetailDto }): JSX.Element {
    return (
        <div className="flex items-center gap-3">
            <span className="text-4xl font-bold leading-none text-foreground">
                {group.activeCount}
            </span>
            <div>
                <p className="text-sm font-semibold text-foreground">
                    {group.activeCount >= 2
                        ? LFG_COPY.statusLfm
                        : LFG_COPY.statusLfg}
                </p>
                <p className="text-xs text-muted">
                    {lookingLine(group.activeCount, group.viabilityThreshold)}
                </p>
                <NowCountLine nowCount={group.nowCount} />
            </div>
            <MemberAvatarGroup
                members={group.members.map(toAvatarMember)}
                gameId={group.gameId}
            />
        </div>
    );
}

