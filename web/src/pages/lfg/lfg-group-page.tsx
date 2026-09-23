/**
 * ROK-1464 — `/lfg/:gameSlug`, the LFG group page.
 *
 * The route is slug-addressed (the design's URL, and what ROK-1453's chips
 * link to) while every read is id-keyed, so the page resolves the slug ONCE
 * via `GET /games/slug/:slug` and then fans out. A failed lookup renders the
 * not-found state rather than firing id-less reads.
 */
import { useCallback, useMemo, type JSX } from 'react';
import { useParams } from 'react-router-dom';
import type {
    LfgGroupDetailDto,
    LfgOverlapWindowDto,
} from '@raid-ledger/contract';
import type { LfgUrgencyPick } from '../../components/lfg/lfg-urgency-choice';
import { useAuth } from '../../hooks/use-auth';
import { useGameDetail } from '../../hooks/use-games-discover';
import {
    useGameBySlug,
    useLfgHistory,
    useLfgOverlap,
    useLfgSuggestions,
} from '../../hooks/use-lfg-reads';
import { useLfgGroupDetail } from '../../hooks/use-lfg-groups';
import { useJoinGroup } from '../../hooks/use-lfg-join';
import { useFindATime, useWithdraw } from '../../hooks/use-lfg-actions';
import { useLockInEvent } from '../../hooks/use-lfg-lock-in';
import { useStartNow } from '../../hooks/use-lfg-start-now';
import { LfgConversationPanel } from './LfgConversationPanel';
import { LfgHeader } from './LfgHeader';
import { LfgHistoryPanel } from './LfgHistoryPanel';
import { LfgOverlapPanel } from './LfgOverlapPanel';
import { LfgSuggestionsPanel } from './LfgSuggestionsPanel';
import { LfgTopBar } from './LfgTopBar';
import { LFG_COPY } from './lfg-copy';
import { LfgGroupOverlays, type LfgOverlayActions } from './lfg-group-overlays';
import { useLfgOverlay } from './use-lfg-overlay';
import { LfgGroupTop } from './lfg-group-top';
import { LfgLoading, LfgNotFound, PendingPollCard } from './lfg-group-states';

/**
 * The poll roster: the live members PLUS the viewer — a viewer who has not
 * raised a hand yet still belongs in the poll they just started (D3).
 */
function usePollMemberIds(group: LfgGroupDetailDto | undefined): number[] {
    const { user } = useAuth();
    return useMemo(() => {
        const ids = new Set((group?.members ?? []).map((m) => m.userId));
        if (user?.id) ids.add(user.id);
        return [...ids];
    }, [group, user]);
}

/**
 * Join / withdraw / start-a-poll / lock-in, each taking the close to run once
 * the write settles so the confirming dialog stays up while it is pending.
 */
function useGroupActions(gameId: number, group: LfgGroupDetailDto | undefined) {
    const join = useJoinGroup();
    const withdraw = useWithdraw();
    const find = useFindATime();
    const lock = useLockInEvent(gameId, group?.gameName ?? '');
    const start = useStartNow(gameId);
    const memberUserIds = usePollMemberIds(group);
    const startPoll = useCallback(
        (done: () => void) => find.findATime({ gameId, memberUserIds }, { onSettled: done }),
        [find, gameId, memberUserIds],
    );
    const dialogs: LfgOverlayActions = {
        startPoll,
        // ROK-1613: `onSettled`, so an AC6 refusal closes the confirm too.
        startNow: (done) => start.startNow({ onSettled: done }),
        lockIn: (window, done) => lock.lockIn(window, { onSuccess: done }),
        // ROK-1479: spread so a weekly pick contributes NO `ttlMinutes` key.
        pickUrgency: (pick, done) => join.mutate({ gameId, ...pick }, { onSuccess: done }),
        withdraw: (done) => withdraw.mutate(gameId, { onSuccess: done }),
        isPollPending: find.isPending,
        isStartNowPending: start.isPending,
        isLockInPending: lock.isPending,
        isWithdrawing: withdraw.isPending,
    };
    return {
        dialogs,
        join: (pick: LfgUrgencyPick) => join.mutate({ gameId, ...pick }),
        isBusy: join.isPending || withdraw.isPending || find.isPending || lock.isPending || start.isPending,
        pendingConvert: find.pendingConvert,
        retryConvert: () => void find.retryConvert(),
    };
}

interface PanelProps {
    gameId: number;
    threadId: string | null;
    onLockIn: (window: LfgOverlapWindowDto) => void;
    isBusy: boolean;
    lockInHint?: string;
}

/** The side-by-side pair: when the group is free, and when it last played. */
function OverlapAndHistory({ gameId, onLockIn, isBusy, lockInHint }: Omit<PanelProps, 'threadId'>): JSX.Element {
    const overlap = useLfgOverlap(gameId);
    const history = useLfgHistory(gameId);
    return (
        <div className="grid gap-4 md:grid-cols-2">
            <LfgOverlapPanel
                overlap={overlap.data}
                isLoading={overlap.isLoading}
                onLockIn={onLockIn}
                isBusy={isBusy}
                disabledHint={lockInHint}
            />
            <LfgHistoryPanel history={history.data} isLoading={history.isLoading} />
        </div>
    );
}

/**
 * The read panels. `threadId` comes from the group read rather than a fourth
 * fetch — the conversation panel renders nothing when it is null (ROK-1483).
 */
function LfgPanels({ threadId, ...overlap }: PanelProps): JSX.Element {
    const suggestions = useLfgSuggestions(overlap.gameId);
    return (
        <>
            <OverlapAndHistory {...overlap} />
            <LfgConversationPanel gameId={overlap.gameId} threadId={threadId} />
            <LfgSuggestionsPanel
                gameId={overlap.gameId}
                suggestions={suggestions.data}
                isLoading={suggestions.isLoading}
                isError={suggestions.isError}
            />
        </>
    );
}

/** The loaded page: top bar → banner → hero → recovery card → panels → dialogs. */
function LfgGroupLoaded({ gameId, fallbackName, group }: { gameId: number; fallbackName: string; group: LfgGroupDetailDto }): JSX.Element {
    const detail = useGameDetail(gameId);
    const actions = useGroupActions(gameId, group);
    const overlays = useLfgOverlay();
    // ROK-1556: the page ends under the fixed mobile tab bar (3.5rem +
    // safe-area), so the last panel needs the same clearance the lineup
    // detail page gives itself (`pb-24 md:pb-*`); desktop has no tab bar.
    return (
        <div className="mx-auto max-w-4xl space-y-4 px-4 pt-6 pb-24 md:pb-6">
            <LfgTopBar onManage={() => overlays.open('manage')} canManage={group.playingNow == null} />
            <LfgHeader gameId={gameId} game={detail.data} fallbackName={fallbackName} />
            <LfgGroupTop
                group={group}
                onJoin={actions.join}
                onStartPoll={() => overlays.open('poll')}
                onStartNow={() => overlays.open('startnow')}
                onParticipants={() => overlays.open('participants')}
                isBusy={actions.isBusy}
            />
            <PendingPollCard pending={actions.pendingConvert} onRetry={actions.retryConvert} />
            <LfgPanels
                gameId={gameId}
                threadId={group.threadId}
                onLockIn={overlays.openLockIn}
                isBusy={actions.isBusy}
                lockInHint={group.ownIntent == null ? LFG_COPY.findATimeNeedsIntent : undefined}
            />
            <LfgGroupOverlays group={group} overlay={overlays.overlay} actions={actions.dialogs} onClose={overlays.close} />
        </div>
    );
}

/** Everything below the slug resolution, keyed by the numeric game id. */
function LfgGroupContent({ gameId, fallbackName }: { gameId: number; fallbackName: string }): JSX.Element {
    const group = useLfgGroupDetail(gameId);
    // A failed group read has no recoverable UI: without the roster there is
    // no count, no join button and no poll membership. Render the error state
    // rather than a skeleton that never resolves.
    if (group.isError) return <LfgNotFound />;
    if (!group.data) return <LfgLoading />;
    return <LfgGroupLoaded gameId={gameId} fallbackName={fallbackName} group={group.data} />;
}

/** `/lfg/:gameSlug` — resolve the slug, then hand off to the id-keyed content. */
export function LfgGroupPage(): JSX.Element {
    const { gameSlug } = useParams<{ gameSlug: string }>();
    const lookup = useGameBySlug(gameSlug);

    if (lookup.isError || (!gameSlug && !lookup.isLoading)) {
        return <LfgNotFound />;
    }
    if (!lookup.data) return <LfgLoading />;
    return (
        <LfgGroupContent
            gameId={lookup.data.id}
            fallbackName={lookup.data.name}
        />
    );
}
