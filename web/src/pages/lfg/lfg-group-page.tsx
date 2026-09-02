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
import { useAuth } from '../../hooks/use-auth';
import { useGameDetail } from '../../hooks/use-games-discover';
import {
    useGameBySlug,
    useLfgGroup,
    useLfgHistory,
    useLfgOverlap,
    useLfgSuggestions,
} from '../../hooks/use-lfg-group';
import {
    useFindATime,
    useJoinGroup,
    useWithdraw,
} from '../../hooks/use-lfg-actions';
import { LfgFullGroupPrompt } from './LfgFullGroupPrompt';
import { LfgHeader } from './LfgHeader';
import { LfgHistoryPanel } from './LfgHistoryPanel';
import { LfgOverlapPanel } from './LfgOverlapPanel';
import { LfgStatusBar } from './LfgStatusBar';
import { LfgSuggestionsPanel } from './LfgSuggestionsPanel';
import {
    LfgLoading,
    LfgNotFound,
    PendingPollCard,
} from './lfg-group-states';

/**
 * Join / withdraw / find-a-time, with the poll roster assembled from the live
 * members PLUS the viewer — a viewer who has not raised a hand yet still
 * belongs in the poll they just started (D3).
 */
function useGroupActions(gameId: number, group: LfgGroupDetailDto | undefined) {
    const { user } = useAuth();
    const join = useJoinGroup();
    const withdraw = useWithdraw();
    const find = useFindATime();

    const memberUserIds = useMemo(() => {
        const ids = new Set((group?.members ?? []).map((m) => m.userId));
        if (user?.id) ids.add(user.id);
        return [...ids];
    }, [group, user]);

    const findATime = useCallback(
        (proposedTime?: string) =>
            find.findATime({ gameId, memberUserIds, proposedTime }),
        [find, gameId, memberUserIds],
    );

    return {
        join: () => join.mutate(gameId),
        withdraw: () => withdraw.mutate(gameId),
        findATime,
        isBusy: join.isPending || withdraw.isPending || find.isPending,
        pendingConvert: find.pendingConvert,
        retryConvert: () => void find.retryConvert(),
    };
}

/** The side-by-side pair: when the group is free, and when it last played. */
function OverlapAndHistory({
    gameId,
    onStartPoll,
    isBusy,
}: {
    gameId: number;
    onStartPoll: (window: LfgOverlapWindowDto) => void;
    isBusy: boolean;
}): JSX.Element {
    const overlap = useLfgOverlap(gameId);
    const history = useLfgHistory(gameId);
    return (
        <div className="grid gap-4 md:grid-cols-2">
            <LfgOverlapPanel
                overlap={overlap.data}
                isLoading={overlap.isLoading}
                onStartPoll={onStartPoll}
                isBusy={isBusy}
            />
            <LfgHistoryPanel
                history={history.data}
                isLoading={history.isLoading}
            />
        </div>
    );
}

/** The three read panels. */
function LfgPanels({
    gameId,
    onStartPoll,
    isBusy,
}: {
    gameId: number;
    onStartPoll: (window: LfgOverlapWindowDto) => void;
    isBusy: boolean;
}): JSX.Element {
    const suggestions = useLfgSuggestions(gameId);
    return (
        <>
            <OverlapAndHistory
                gameId={gameId}
                onStartPoll={onStartPoll}
                isBusy={isBusy}
            />
            <LfgSuggestionsPanel
                suggestions={suggestions.data}
                isLoading={suggestions.isLoading}
            />
        </>
    );
}

/** Status bar, viability prompt and the convert-failure recovery card. */
function GroupControls({
    group,
    actions,
}: {
    group: LfgGroupDetailDto;
    actions: ReturnType<typeof useGroupActions>;
}): JSX.Element {
    return (
        <>
            <LfgStatusBar
                group={group}
                onJoin={actions.join}
                onWithdraw={actions.withdraw}
                onFindATime={() => actions.findATime()}
                isBusy={actions.isBusy}
            />
            <LfgFullGroupPrompt
                group={group}
                onFindATime={() => actions.findATime()}
                isBusy={actions.isBusy}
            />
            <PendingPollCard
                pending={actions.pendingConvert}
                onRetry={actions.retryConvert}
            />
        </>
    );
}

/** Everything below the slug resolution, keyed by the numeric game id. */
function LfgGroupContent({
    gameId,
    fallbackName,
}: {
    gameId: number;
    fallbackName: string;
}): JSX.Element {
    const detail = useGameDetail(gameId);
    const group = useLfgGroup(gameId);
    const actions = useGroupActions(gameId, group.data);

    if (!group.data) return <LfgLoading />;
    return (
        <div className="mx-auto max-w-4xl space-y-4 px-4 py-6">
            <LfgHeader
                gameId={gameId}
                game={detail.data}
                fallbackName={fallbackName}
            />
            <GroupControls group={group.data} actions={actions} />
            <LfgPanels
                gameId={gameId}
                onStartPoll={(w) => actions.findATime(w.start)}
                isBusy={actions.isBusy}
            />
        </div>
    );
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
