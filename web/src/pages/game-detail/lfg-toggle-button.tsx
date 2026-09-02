/**
 * "Looking for group" toggle for the game detail page (ROK-1453).
 *
 * The write half of the LFG chips: it is the only place in the UI that raises
 * or withdraws an intent. Every other LFG surface — the tile chip, the events
 * banner, the cold-start prompt — is a cached read under the `['lfg']` prefix,
 * so the invalidation on success is load-bearing, not hygiene: without it the
 * click succeeds and the page keeps rendering the pre-click world.
 *
 * Rendered inside the detail page's authenticated stats row, so it needs no
 * auth guard of its own.
 */
import type { JSX } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createIntent, withdrawIntent } from '../../lib/api/lfg-api';
import { useLfgGroupDetail } from '../../hooks/use-lfg-groups';
import { toast } from '../../lib/toast';

const BASE_CLS =
    'flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-60';

const ACTIVE_CLS = 'bg-amber-300/95 text-amber-950 hover:bg-amber-200';
const IDLE_CLS =
    'bg-panel text-secondary border border-edge hover:border-amber-400/60 hover:text-foreground';

/** Raise or withdraw the viewer's own LFG intent for one game. */
export function LfgToggleButton({ gameId }: { gameId: number }): JSX.Element {
    const queryClient = useQueryClient();
    const { data, isSuccess } = useLfgGroupDetail(gameId);
    const hasOwnIntent = data?.hasOwnIntent ?? false;

    const mutation = useMutation<void, Error, void>({
        // The response body is unused here — ROK-1464 is the caller that wants
        // the created intent back.
        mutationFn: async () => {
            if (hasOwnIntent) return withdrawIntent(gameId);
            await createIntent(gameId);
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lfg'] }),
        onError: () =>
            toast.error(
                hasOwnIntent
                    ? 'Failed to withdraw from the group'
                    : 'Failed to join the group',
            ),
    });

    return (
        <button
            type="button"
            data-testid="lfg-toggle"
            aria-pressed={hasOwnIntent}
            // `hasOwnIntent` defaults to false while the read is in flight, so
            // an early click would raise an intent the viewer may already hold
            // — exactly when they meant to withdraw. Nothing is actionable
            // until their own state is known.
            disabled={mutation.isPending || !isSuccess}
            onClick={() => mutation.mutate()}
            className={`${BASE_CLS} ${hasOwnIntent ? ACTIVE_CLS : IDLE_CLS}`}
        >
            {hasOwnIntent ? '🎯 Looking (Withdraw)' : '🎯 Looking for group'}
        </button>
    );
}
