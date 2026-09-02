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
import { LFG_COPY, lookingLine } from './lfg-copy';

export interface LfgStatusBarProps {
    group: LfgGroupDetailDto;
    onJoin: () => void;
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
    'px-3 py-1.5 rounded-md text-sm font-semibold bg-overlay hover:bg-zinc-700 text-zinc-200 disabled:opacity-50';

/** Empty group: no count, no avatars — just the invitation to be first. */
function EmptyState({
    onJoin,
    isBusy,
}: {
    onJoin: () => void;
    isBusy?: boolean;
}): JSX.Element {
    return (
        <div
            data-testid="lfg-status-bar"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface p-4"
        >
            <p className="text-sm text-muted">{LFG_COPY.emptyState}</p>
            <button
                type="button"
                className={PRIMARY_BTN}
                onClick={onJoin}
                disabled={isBusy}
            >
                {LFG_COPY.join}
            </button>
        </div>
    );
}

/** Count + label + roster avatars. */
function GroupSummary({ group }: { group: LfgGroupDetailDto }): JSX.Element {
    return (
        <div className="flex items-center gap-3">
            <span className="text-4xl font-bold leading-none text-zinc-100">
                {group.activeCount}
            </span>
            <div>
                <p className="text-sm font-semibold text-zinc-100">
                    {group.activeCount >= 2
                        ? LFG_COPY.statusLfm
                        : LFG_COPY.statusLfg}
                </p>
                <p className="text-xs text-muted">
                    {lookingLine(group.activeCount, group.viabilityThreshold)}
                </p>
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
        <div className="flex items-center gap-2">
            <button
                type="button"
                className={holdsIntent ? SECONDARY_BTN : PRIMARY_BTN}
                onClick={holdsIntent ? onWithdraw : onJoin}
                disabled={isBusy}
            >
                {holdsIntent ? LFG_COPY.withdraw : LFG_COPY.join}
            </button>
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
        return <EmptyState onJoin={onJoin} isBusy={isBusy} />;
    }
    return (
        <div
            data-testid="lfg-status-bar"
            className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-surface p-4"
        >
            <GroupSummary group={group} />
            <BarActions {...props} />
        </div>
    );
}
