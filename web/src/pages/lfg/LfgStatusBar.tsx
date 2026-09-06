/**
 * ROK-1464 AC2 — the LFG group status bar.
 *
 * The count is the headline; the label is the ONLY place the derived LFG → LFM
 * transition surfaces. Join/withdraw is decided by `ownIntent`, not by a local
 * optimistic flag, so a stale tab always reflects the server.
 */
import type { JSX } from 'react';
import type { LfgGroupDetailDto, LfgMemberDto } from '@raid-ledger/contract';
import { MemberAvatarGroup } from '../../components/lineups/decided/MemberAvatarGroup';
import { nowLine } from '../../components/lfg/lfg-chip-copy';
import type { LfgUrgencyPick } from '../../components/lfg/lfg-urgency-choice';
import { LfgJoinControl } from './LfgJoinControl';
import { LfgNowStrip } from './LfgNowStrip';
import { LFG_COPY, lookingLine } from './lfg-copy';

export interface LfgStatusBarProps {
    group: LfgGroupDetailDto;
    /**
     * Receives the viewer's urgency pick (ROK-1479): the group page can now
     * post a `now` intent, not only the weekly one the button used to imply.
     */
    onJoin: (pick: LfgUrgencyPick) => void;
    onWithdraw: () => void;
    onFindATime: () => void;
    /** Disables the write buttons while a mutation is in flight. */
    isBusy?: boolean;
}

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

const PRIMARY_BTN =
    'px-3 py-1.5 rounded-md text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50';
const SECONDARY_BTN =
    'px-3 py-1.5 rounded-md text-sm font-semibold bg-overlay hover:bg-faint text-foreground disabled:opacity-50';

/** Empty group: no count, no avatars — just the invitation to be first. */
function EmptyState({
    gameName,
    onJoin,
    isBusy,
}: {
    gameName: string;
    onJoin: (pick: LfgUrgencyPick) => void;
    isBusy?: boolean;
}): JSX.Element {
    return (
        <div
            data-testid="lfg-status-bar"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface p-4"
        >
            <p className="text-sm text-muted">{LFG_COPY.emptyState}</p>
            <LfgJoinControl
                label={gameName}
                onJoin={onJoin}
                className={PRIMARY_BTN}
                isBusy={isBusy}
            />
        </div>
    );
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

/** Count + label + roster avatars. */
function GroupSummary({ group }: { group: LfgGroupDetailDto }): JSX.Element {
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

/** Join-or-withdraw plus the scheduling escape hatch. */
function BarActions({
    group,
    onJoin,
    onWithdraw,
    onFindATime,
    isBusy,
}: LfgStatusBarProps): JSX.Element {
    const holdsIntent = group.ownIntent != null;
    return (
        <div className="flex flex-wrap items-center gap-2">
            {holdsIntent ? (
                <button
                    type="button"
                    className={SECONDARY_BTN}
                    onClick={onWithdraw}
                    disabled={isBusy}
                >
                    {LFG_COPY.withdraw}
                </button>
            ) : (
                <LfgJoinControl
                    label={group.gameName}
                    onJoin={onJoin}
                    className={PRIMARY_BTN}
                    isBusy={isBusy}
                />
            )}
            <button
                type="button"
                className={SECONDARY_BTN}
                onClick={onFindATime}
                disabled={isBusy || !holdsIntent}
                title={holdsIntent ? undefined : LFG_COPY.findATimeNeedsIntent}
            >
                {LFG_COPY.findATime}
            </button>
        </div>
    );
}

/** The status bar: who is looking, and the two things a viewer can do about it. */
export function LfgStatusBar(props: LfgStatusBarProps): JSX.Element {
    const { group, onJoin, isBusy } = props;
    if (group.activeCount === 0) {
        return (
            <EmptyState
                gameName={group.gameName}
                onJoin={onJoin}
                isBusy={isBusy}
            />
        );
    }
    return (
        <div
            data-testid="lfg-status-bar"
            className="rounded-xl bg-surface p-4"
        >
            <LfgNowStrip members={group.members} />
            <div className="flex flex-wrap items-center justify-between gap-4">
                <GroupSummary group={group} />
                <BarActions {...props} />
            </div>
        </div>
    );
}
