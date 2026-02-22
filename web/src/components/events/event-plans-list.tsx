import { useMemo } from 'react';
import { useMyEventPlans, useCancelEventPlan } from '../../hooks/use-event-plans';
import { useGameRegistry } from '../../hooks/use-game-registry';
import type { EventPlanResponseDto, EventPlanStatus, PollMode } from '@raid-ledger/contract';

const STATUS_STYLES: Record<EventPlanStatus, { bg: string; text: string; label: string }> = {
    polling: { bg: 'bg-blue-500/15', text: 'text-blue-300', label: 'Polling' },
    completed: { bg: 'bg-emerald-500/15', text: 'text-emerald-300', label: 'Completed' },
    expired: { bg: 'bg-amber-500/15', text: 'text-amber-300', label: 'Expired' },
    cancelled: { bg: 'bg-red-500/15', text: 'text-red-300', label: 'Cancelled' },
    draft: { bg: 'bg-gray-500/15', text: 'text-gray-300', label: 'Draft' },
};

const POLL_MODE_LABELS: Record<PollMode, string> = {
    standard: 'Standard',
    all_or_nothing: 'All or Nothing',
};

function formatTimeRemaining(pollEndsAt: string | null): string | null {
    if (!pollEndsAt) return null;
    const now = Date.now();
    const end = new Date(pollEndsAt).getTime();
    const diff = end - now;
    if (diff <= 0) return 'Ended';
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `${hours}h ${minutes}m remaining`;
    return `${minutes}m remaining`;
}

function PlanCard({
    plan,
    gameName,
    onCancel,
    isCancelling,
}: {
    plan: EventPlanResponseDto;
    gameName: string | null;
    onCancel: (planId: string) => void;
    isCancelling: boolean;
}) {
    const statusStyle = STATUS_STYLES[plan.status] ?? STATUS_STYLES.draft;
    const timeRemaining = plan.status === 'polling' ? formatTimeRemaining(plan.pollEndsAt) : null;

    const handleCancel = () => {
        if (window.confirm(`Cancel the plan "${plan.title}"? This will end the Discord poll.`)) {
            onCancel(plan.id);
        }
    };

    return (
        <div className="bg-panel border border-edge rounded-xl p-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-lg font-semibold text-foreground truncate">
                        {plan.title}
                    </h3>
                    {gameName && (
                        <p className="text-sm text-muted mt-0.5">{gameName}</p>
                    )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <span
                        className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full ${statusStyle.bg} ${statusStyle.text}`}
                    >
                        {statusStyle.label}
                    </span>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-violet-500/15 text-violet-300">
                    {POLL_MODE_LABELS[plan.pollMode]}
                </span>
                {plan.pollRound > 1 && (
                    <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-indigo-500/15 text-indigo-300">
                        Round {plan.pollRound}
                    </span>
                )}
                {timeRemaining && (
                    <span className="text-muted">
                        {timeRemaining}
                    </span>
                )}
            </div>

            {plan.status === 'polling' && (
                <div className="pt-1">
                    <button
                        type="button"
                        onClick={handleCancel}
                        disabled={isCancelling}
                        className="px-4 py-2 text-sm font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isCancelling ? 'Cancelling...' : 'Cancel Plan'}
                    </button>
                </div>
            )}
        </div>
    );
}

export function EventPlansList() {
    const { data: plans, isLoading, error } = useMyEventPlans();
    const { games } = useGameRegistry();
    const cancelMutation = useCancelEventPlan();

    const gameMap = useMemo(() => {
        const map = new Map<number, string>();
        for (const game of games) {
            map.set(game.id, game.name);
        }
        return map;
    }, [games]);

    if (isLoading) {
        return (
            <div className="space-y-4">
                {Array.from({ length: 3 }).map((_, i) => (
                    <div
                        key={i}
                        className="bg-panel border border-edge rounded-xl p-5 animate-pulse"
                    >
                        <div className="h-5 w-48 bg-surface rounded mb-3" />
                        <div className="h-4 w-32 bg-surface rounded mb-3" />
                        <div className="flex gap-2">
                            <div className="h-5 w-20 bg-surface rounded-full" />
                            <div className="h-5 w-24 bg-surface rounded-full" />
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    if (error) {
        return (
            <div className="text-center py-12">
                <p className="text-red-400">Failed to load plans: {error.message}</p>
            </div>
        );
    }

    if (!plans || plans.length === 0) {
        return (
            <div className="text-center py-16">
                <svg
                    className="w-12 h-12 mx-auto text-muted mb-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                    />
                </svg>
                <p className="text-muted text-lg mb-1">No event plans yet</p>
                <p className="text-muted/70 text-sm">
                    Use Plan Event to poll your community for the best time.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {plans.map((plan) => (
                <PlanCard
                    key={plan.id}
                    plan={plan}
                    gameName={plan.gameId ? (gameMap.get(plan.gameId) ?? null) : null}
                    onCancel={(planId) => cancelMutation.mutate(planId)}
                    isCancelling={cancelMutation.isPending && cancelMutation.variables === plan.id}
                />
            ))}
        </div>
    );
}
