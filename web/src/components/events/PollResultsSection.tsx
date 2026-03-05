import { useEventPlanPollResults } from '../../hooks/use-event-plans';
import type { EventPlanResponseDto, PollOptionResult } from '@raid-ledger/contract';

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

export function PollResultsSection({ planId }: { planId: string }) {
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

export function CompletedResultsSection({ plan }: { plan: EventPlanResponseDto }) {
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
