/**
 * ROK-2352 §3.2 — the show-once notice that a lock-in elsewhere withdrew one
 * of the viewer's other `now` hands in this game. The server lists unseen
 * notices on `GET /lfg/:gameId/groups`; showing them acks them (one call per
 * batch of ≤50 ids) and refreshes that query, so they never come back. The
 * banner keeps what it showed until dismissed, so the refetch does not yank
 * it away. §4.7 neutral one-line callout (the `SteamNudgeBanner` shape).
 */
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { LfgClearedHandNoticeDto } from '@raid-ledger/contract';
import { Button } from '../../components/ui/button';
import type { LfgGrouping, LfgGroupingContext } from '../../plugins/lfg-grouping';
import { useLfgGameGroups } from '../../hooks/use-lfg-game-groups';
import { ackLfgHandNotices } from '../../lib/api/lfg-group-api';
import { CLEARED_HAND_COPY, clearedHandNoticeText, noticeGroupLabel } from './lfg-cleared-hand-notice.helpers';

const NO_NOTICES: readonly LfgClearedHandNoticeDto[] = [];
const ACK_BATCH = 50;

interface Props {
    grouping: LfgGrouping | null;
    context: LfgGroupingContext;
}

/** Ack every id once (chunks of 50); invalidate the groups query after each ack lands. */
function useAckOnce(gameId: number): (ids: number[]) => void {
    const queryClient = useQueryClient();
    const { mutate } = useMutation({
        mutationFn: ackLfgHandNotices,
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lfg', 'game-groups', gameId] }),
    });
    return useCallback((ids: number[]) => {
        for (let i = 0; i < ids.length; i += ACK_BATCH) mutate(ids.slice(i, i + ACK_BATCH));
    }, [mutate]);
}

/** The notices on screen: each new id is shown and acked exactly once. */
function useShownNotices(gameId: number, notices: readonly LfgClearedHandNoticeDto[]) {
    const [shown, setShown] = useState<LfgClearedHandNoticeDto[]>([]);
    const seen = useRef(new Set<number>());
    const ack = useAckOnce(gameId);
    useEffect(() => {
        const fresh = notices.filter((n) => !seen.current.has(n.intentId));
        if (fresh.length === 0) return;
        for (const n of fresh) seen.current.add(n.intentId);
        setShown((prev) => [...prev, ...fresh]);
        ack(fresh.map((n) => n.intentId));
    }, [notices, ack]);
    return { shown, dismiss: () => setShown([]) };
}

export function LfgClearedHandNotices({ grouping, context }: Props): JSX.Element | null {
    const groups = useLfgGameGroups(context.gameId, grouping !== null);
    const { shown, dismiss } = useShownNotices(context.gameId, groups.data?.notices ?? NO_NOTICES);
    if (shown.length === 0) return null;
    const known = groups.data?.groups ?? [];
    const label = (key: string, value: string | null) => noticeGroupLabel(key, value, grouping, known);
    return (
        <div role="status" data-testid="lfg-cleared-hand-notice"
            className="flex items-start justify-between gap-3 rounded-lg border border-edge bg-overlay/30 px-4 py-2 text-sm text-secondary">
            <ul className="min-w-0 flex-1 space-y-1 self-center">
                {shown.map((n) => (
                    <li key={n.intentId}>{clearedHandNoticeText(label(n.fromGroupKey, n.fromLabel), label(n.toGroupKey, n.toLabel))}</li>
                ))}
            </ul>
            <Button variant="ghost" size="sm" iconOnly aria-label={CLEARED_HAND_COPY.dismiss} onClick={dismiss}>
                <span aria-hidden className="text-lg leading-none">&times;</span>
            </Button>
        </div>
    );
}
