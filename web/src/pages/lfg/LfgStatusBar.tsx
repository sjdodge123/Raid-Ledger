/**
 * ROK-1464 AC2 — the LFG group status bar.
 *
 * The count is the headline; the label is the ONLY place the derived LFG → LFM
 * transition surfaces. Join/withdraw is decided by `ownIntent`, not by a local
 * optimistic flag, so a stale tab always reflects the server.
 */
import type { JSX } from 'react';
import type { LfgGroupDetailDto } from '@raid-ledger/contract';
import type { LfgUrgencyPick } from '../../components/lfg/lfg-urgency-choice';
import { GroupSummary } from './LfgGroupSummary';
import { LfgJoinControl } from './LfgJoinControl';
import { LfgNowStrip } from './LfgNowStrip';
import { LfgPlayingNowCard } from './LfgPlayingNowCard';
import { LFG_COPY } from './lfg-copy';

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

/** Whichever of the two the viewer's own intent calls for. */
function JoinOrWithdraw({
    group,
    onJoin,
    onWithdraw,
    isBusy,
}: Omit<LfgStatusBarProps, 'onFindATime'>): JSX.Element {
    return (
        <>
            {group.ownIntent != null ? (
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
        </>
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
            <JoinOrWithdraw
                group={group}
                onJoin={onJoin}
                onWithdraw={onWithdraw}
                isBusy={isBusy}
            />
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

/**
 * A group mid-session: the card, plus whatever hands are still up.
 *
 * No join/withdraw and no Find a time (D10) — the spawn converted the intents,
 * so the actions would act on rows that no longer exist.
 */
function PlayingState({ group }: { group: LfgGroupDetailDto }): JSX.Element {
    return (
        <div
            data-testid="lfg-status-bar"
            className="space-y-3 rounded-xl bg-surface p-4"
        >
            <LfgPlayingNowCard playingNow={group.playingNow} />
            <LfgNowStrip members={group.members} />
        </div>
    );
}

/** The status bar: who is looking, and the two things a viewer can do about it. */
export function LfgStatusBar(props: LfgStatusBarProps): JSX.Element {
    const { group, onJoin, isBusy } = props;
    // ROK-1494 D10 — a spawned session is decided by `playingNow`, never by a
    // count: the spawn CONVERTS the intents, so `activeCount` is 0 and the
    // branch below would invite the viewer to be the first to look while the
    // group is mid-session. It also removes `Find a time`, which would build a
    // scheduling poll for people already in voice.
    if (group.playingNow != null) return <PlayingState group={group} />;
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
