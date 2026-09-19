/**
 * ROK-1573/1572/1571 — the top of the LFG group page, under `LfgHeader`.
 *
 * Three shapes:
 *  - playing now (ROK-1494 D10): the session card plus whatever hands are
 *    still up, and NO actions — the spawn converted the intents, so a poll or
 *    a join would act on rows that no longer exist;
 *  - otherwise the ONE hero card (`LfgHero`) with the scheduling-poll primary,
 *    or "Open the event" once the group was locked into one — but ONLY while
 *    no hands are up (`activeCount === 0`): people who +1 after a lock-in are
 *    a new group and get the looking/full hero, the poll and the join row;
 *  - under the hero, the "Right now" strip (ROK-1479 A7) when any member is up
 *    right now — renders nothing otherwise;
 *  - plus, for a viewer who holds no intent, the `+1 · I'm in` join row under
 *    the hero (ROK-1479's urgency choice) — the poll primary stays disabled
 *    with the needs-intent hint until they are in (same gate as before).
 */
import type { JSX } from 'react';
import type { LfgGroupDetailDto } from '@raid-ledger/contract';
import type { LfgUrgencyPick } from '../../components/lfg/lfg-urgency-choice';
import { LfgHero } from './LfgHero';
import { LfgJoinControl } from './LfgJoinControl';
import { LfgNowStrip } from './LfgNowStrip';
import { LfgParticipantsChip } from './LfgParticipantsChip';
import { LfgPlayingNowCard } from './LfgPlayingNowCard';
import { LFG_SECONDARY_BTN } from './lfg-action-buttons';
import { LFG_COPY } from './lfg-copy';

export interface LfgGroupTopProps {
    group: LfgGroupDetailDto;
    onJoin: (pick: LfgUrgencyPick) => void;
    onStartPoll: () => void;
    /** ROK-1613 — open the start-now confirm. Always offered while looking. */
    onStartNow: () => void;
    onParticipants: () => void;
    isBusy?: boolean;
}

/** A group mid-session: the card and the now strip, nothing to press. */
function PlayingState({ group }: { group: LfgGroupDetailDto }): JSX.Element {
    return (
        <div data-testid="lfg-playing-state" className="space-y-3 rounded-xl bg-surface p-4">
            <LfgPlayingNowCard playingNow={group.playingNow} />
            <LfgNowStrip members={group.members} />
        </div>
    );
}

/** `+1 · I'm in` for a viewer with no intent; the empty-group invite beside it. */
function JoinRow({ group, onJoin, isBusy }: Pick<LfgGroupTopProps, 'group' | 'onJoin' | 'isBusy'>): JSX.Element {
    return (
        <div data-testid="lfg-join-row" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface p-4">
            {group.activeCount === 0 && <p className="text-sm text-muted">{LFG_COPY.emptyState}</p>}
            <LfgJoinControl label={group.gameName} onJoin={onJoin} className={LFG_SECONDARY_BTN} isBusy={isBusy} />
        </div>
    );
}

/** Playing state, or the hero (plus the join row while the viewer is out). */
export function LfgGroupTop({ group, onJoin, onStartPoll, onStartNow, onParticipants, isBusy }: LfgGroupTopProps): JSX.Element {
    if (group.playingNow != null) return <PlayingState group={group} />;
    const holdsIntent = group.ownIntent != null;
    // A locked-in event must not hide a new live group (ROK-1573 review P1).
    const event = group.activeCount === 0 ? group.convertedEvent : null;
    return (
        <>
            <LfgHero
                group={group}
                convertedEvent={event}
                participants={<LfgParticipantsChip members={group.members} onOpen={onParticipants} />}
                primaryDisabledHint={holdsIntent ? undefined : LFG_COPY.heroNeedsIntent}
                onStartPoll={onStartPoll}
                onStartNow={onStartNow}
            />
            {/* ROK-1479 A7: who is up RIGHT NOW, with their remaining time — the
                status bar that carried it is gone, so it sits under the hero. */}
            <LfgNowStrip members={group.members} />
            {/* ROK-1613: the join row is NOT suppressed by a locked-in event.
                Start-now needs an intent (AC6), and in the event-set state
                `activeCount === 0`, so nobody has one — without this the
                button would render permanently disabled with no way in. */}
            {!holdsIntent && <JoinRow group={group} onJoin={onJoin} isBusy={isBusy} />}
        </>
    );
}
