import { useMemo, useState } from 'react';
import {
    useMyEventPlans,
    useCancelEventPlan,
    useEventPlanPollResults,
    useRestartEventPlan,
} from '../../hooks/use-event-plans';
import { useGameRegistry } from '../../hooks/use-game-registry';
import type {
    EventPlanResponseDto,
    EventPlanStatus,
    PollMode,
    PollOptionResult,
} from '@raid-ledger/contract';

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

function formatDuration(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h`;
    return `${mins}m`;
}

function formatSlotConfig(
    slotConfig: EventPlanResponseDto['slotConfig'],
): string | null {
    if (!slotConfig) return null;
    if (slotConfig.type === 'mmo') {
        const parts: string[] = [];
        if (slotConfig.tank) parts.push(`${slotConfig.tank} Tank`);
        if (slotConfig.healer) parts.push(`${slotConfig.healer} Healer`);
        if (slotConfig.dps) parts.push(`${slotConfig.dps} DPS`);
        if (slotConfig.flex) parts.push(`${slotConfig.flex} Flex`);
        if (slotConfig.bench) parts.push(`${slotConfig.bench} Bench`);
        return parts.join(' · ');
    }
    if (slotConfig.type === 'generic') {
        const parts: string[] = [];
        if (slotConfig.player) parts.push(`${slotConfig.player} Players`);
        if (slotConfig.bench) parts.push(`${slotConfig.bench} Bench`);
        return parts.join(' · ');
    }
    return null;
}

function VoteBar({ option, maxVotes, isWinner }: {
    option: PollOptionResult;
    maxVotes: number;
    isWinner?: boolean;
}) {
    const pct = maxVotes > 0 ? (option.registeredVotes / maxVotes) * 100 : 0;

    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between text-sm">
                <span className={`truncate mr-2 ${isWinner ? 'text-emerald-300 font-medium' : 'text-foreground'}`}>
                    {isWinner && (
                        <svg className="inline w-4 h-4 mr-1 -mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                    )}
                    {option.label}
                </span>
                <span className="text-muted text-xs shrink-0">
                    {option.registeredVotes} vote{option.registeredVotes !== 1 ? 's' : ''}
                    {option.totalVotes > option.registeredVotes && (
                        <span className="text-muted/50"> ({option.totalVotes} total)</span>
                    )}
                </span>
            </div>
            <div className="h-2 bg-surface rounded-full overflow-hidden">
                <div
                    className={`h-full rounded-full transition-all duration-500 ${
                        isWinner ? 'bg-emerald-500' : 'bg-violet-500/70'
                    }`}
                    style={{ width: `${pct}%` }}
                />
            </div>
            {option.voters.length > 0 && (
                <p className="text-xs text-muted/70 truncate">
                    {option.voters
                        .map((v) => v.username ?? v.discordId)
                        .join(', ')}
                </p>
            )}
        </div>
    );
}

function PollResultsSection({ planId }: { planId: string }) {
    const { data: results, isLoading, error } = useEventPlanPollResults(planId, true);

    if (isLoading) {
        return (
            <div className="space-y-2 animate-pulse">
                {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-8 bg-surface rounded" />
                ))}
            </div>
        );
    }

    if (error || !results) {
        return (
            <p className="text-sm text-muted/70">
                {error ? 'Could not load poll results' : 'No results available'}
            </p>
        );
    }

    if (results.pollOptions.length === 0) {
        return <p className="text-sm text-muted/70">No votes yet</p>;
    }

    const maxVotes = Math.max(
        ...results.pollOptions.map((o) => o.registeredVotes),
        results.noneOption?.registeredVotes ?? 0,
    );

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-foreground">Poll Results</h4>
                <span className="text-xs text-muted">
                    {results.totalRegisteredVoters} registered voter{results.totalRegisteredVoters !== 1 ? 's' : ''}
                </span>
            </div>
            <div className="space-y-2.5">
                {results.pollOptions.map((option) => (
                    <VoteBar key={option.index} option={option} maxVotes={maxVotes} />
                ))}
                {results.noneOption && results.noneOption.totalVotes > 0 && (
                    <div className="pt-1 border-t border-edge">
                        <VoteBar option={results.noneOption} maxVotes={maxVotes} />
                    </div>
                )}
            </div>
        </div>
    );
}

function CompletedResultsSection({
    plan,
}: {
    plan: EventPlanResponseDto;
}) {
    if (plan.winningOption === null) return null;

    const winningLabel = plan.pollOptions[plan.winningOption]?.label ?? 'Unknown';

    return (
        <div className="space-y-2">
            <h4 className="text-sm font-medium text-foreground">Result</h4>
            <div className="flex items-center gap-2 text-sm">
                <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span className="text-emerald-300 font-medium">{winningLabel}</span>
            </div>
            {plan.createdEventId && (
                <a
                    href={`/events/${plan.createdEventId}`}
                    className="inline-flex items-center gap-1.5 text-sm text-violet-400 hover:text-violet-300 transition-colors"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                    View Event
                </a>
            )}
        </div>
    );
}

function PlanCard({
    plan,
    gameName,
    onCancel,
    isCancelling,
    onRestart,
    isRestarting,
}: {
    plan: EventPlanResponseDto;
    gameName: string | null;
    onCancel: (planId: string) => void;
    isCancelling: boolean;
    onRestart: (planId: string) => void;
    isRestarting: boolean;
}) {
    const [showResults, setShowResults] = useState(plan.status === 'polling');
    const statusStyle = STATUS_STYLES[plan.status] ?? STATUS_STYLES.draft;
    const timeRemaining = plan.status === 'polling' ? formatTimeRemaining(plan.pollEndsAt) : null;
    const rosterSummary = formatSlotConfig(plan.slotConfig);

    const handleCancel = () => {
        if (window.confirm(`Cancel the plan "${plan.title}"? This will end the Discord poll.`)) {
            onCancel(plan.id);
        }
    };

    const handleRestart = () => {
        if (window.confirm(`Restart the poll for "${plan.title}"? A new Discord poll will be posted.`)) {
            onRestart(plan.id);
        }
    };

    const canRestart = plan.status === 'cancelled' || plan.status === 'expired';

    return (
        <div className="bg-panel border border-edge rounded-xl p-5 space-y-3">
            {/* Header */}
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

            {/* Badges row */}
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
                    <span className="text-blue-300 font-medium">
                        {timeRemaining}
                    </span>
                )}
            </div>

            {/* Plan details */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                <span>Duration: {formatDuration(plan.durationMinutes)}</span>
                {rosterSummary && <span>Roster: {rosterSummary}</span>}
            </div>

            {plan.description && (
                <p className="text-sm text-muted/80 line-clamp-2">{plan.description}</p>
            )}

            {/* Poll results for active polls */}
            {plan.status === 'polling' && (
                <div className="pt-2 border-t border-edge space-y-3">
                    <button
                        type="button"
                        onClick={() => setShowResults((s) => !s)}
                        className="flex items-center gap-1 text-sm text-violet-400 hover:text-violet-300 transition-colors"
                    >
                        <svg
                            className={`w-4 h-4 transition-transform ${showResults ? 'rotate-90' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        {showResults ? 'Hide Results' : 'Show Results'}
                    </button>
                    {showResults && <PollResultsSection planId={plan.id} />}
                </div>
            )}

            {/* Completed plan results */}
            {plan.status === 'completed' && (
                <div className="pt-2 border-t border-edge">
                    <CompletedResultsSection plan={plan} />
                </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2 pt-1">
                {plan.status === 'polling' && (
                    <button
                        type="button"
                        onClick={handleCancel}
                        disabled={isCancelling}
                        className="px-4 py-2 text-sm font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isCancelling ? 'Cancelling...' : 'Cancel Plan'}
                    </button>
                )}
                {canRestart && (
                    <button
                        type="button"
                        onClick={handleRestart}
                        disabled={isRestarting}
                        className="px-4 py-2 text-sm font-medium text-violet-400 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/30 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isRestarting ? 'Restarting...' : 'Restart Poll'}
                    </button>
                )}
            </div>
        </div>
    );
}

export function EventPlansList() {
    const { data: plans, isLoading, error } = useMyEventPlans();
    const { games } = useGameRegistry();
    const cancelMutation = useCancelEventPlan();
    const restartMutation = useRestartEventPlan();

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
                    onRestart={(planId) => restartMutation.mutate(planId)}
                    isRestarting={restartMutation.isPending && restartMutation.variables === plan.id}
                />
            ))}
        </div>
    );
}
