import { useMemo, useState } from 'react';
import {
    useMyEventPlans,
    useCancelEventPlan,
    useRestartEventPlan,
} from '../../hooks/use-event-plans';
import { useGameRegistry } from '../../hooks/use-game-registry';
import { useAuth } from '../../hooks/use-auth';
import type { EventPlanResponseDto } from '@raid-ledger/contract';
import { STATUS_STYLES, POLL_MODE_LABELS, formatTimeRemaining, formatDuration, formatSlotConfig } from './event-plans-list.utils';
import { PollResultsSection, CompletedResultsSection } from './PollResultsSection';

function PlanHeader({ plan, gameName }: { plan: EventPlanResponseDto; gameName: string | null }) {
    const statusStyle = STATUS_STYLES[plan.status] ?? STATUS_STYLES.draft;
    return (
        <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
                <h3 className="text-lg font-semibold text-foreground truncate">{plan.title}</h3>
                {gameName && <p className="text-sm text-muted mt-0.5">{gameName}</p>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
                <span className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full ${statusStyle.bg} ${statusStyle.text}`}>
                    {statusStyle.label}
                </span>
            </div>
        </div>
    );
}

function PlanBadges({ plan }: { plan: EventPlanResponseDto }) {
    const timeRemaining = plan.status === 'polling' ? formatTimeRemaining(plan.pollEndsAt) : null;
    return (
        <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-violet-500/15 text-violet-300">
                {POLL_MODE_LABELS[plan.pollMode]}
            </span>
            {plan.pollRound > 1 && (
                <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-indigo-500/15 text-indigo-300">
                    Round {plan.pollRound}
                </span>
            )}
            {timeRemaining && <span className="text-blue-300 font-medium">{timeRemaining}</span>}
        </div>
    );
}

function PlanDetails({ plan }: { plan: EventPlanResponseDto }) {
    const rosterSummary = formatSlotConfig(plan.slotConfig);
    return (
        <>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                <span>Duration: {formatDuration(plan.durationMinutes)}</span>
                {rosterSummary && <span>Roster: {rosterSummary}</span>}
            </div>
            {plan.description && <p className="text-sm text-muted/80 line-clamp-2">{plan.description}</p>}
        </>
    );
}

function confirmCancel(plan: EventPlanResponseDto, onCancel: (id: string) => void) {
    if (window.confirm(`Cancel the plan "${plan.title}"? This will end the Discord poll.`)) onCancel(plan.id);
}

function confirmRestart(plan: EventPlanResponseDto, onRestart: (id: string) => void) {
    const message = plan.status === 'draft'
        ? `Publish "${plan.title}"? A Discord poll will be posted.`
        : `Restart the poll for "${plan.title}"? A new Discord poll will be posted.`;
    if (window.confirm(message)) onRestart(plan.id);
}

function PlanActions({ plan, onCancel, isCancelling, onRestart, isRestarting }: {
    plan: EventPlanResponseDto; onCancel: (id: string) => void; isCancelling: boolean;
    onRestart: (id: string) => void; isRestarting: boolean;
}) {
    const canRestart = plan.status === 'cancelled' || plan.status === 'expired' || plan.status === 'draft';
    return (
        <div className="flex flex-wrap gap-2 pt-1">
            {plan.status === 'polling' && (
                <button type="button" onClick={() => confirmCancel(plan, onCancel)} disabled={isCancelling}
                    className="px-4 py-2 text-sm font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                    {isCancelling ? 'Cancelling...' : 'Cancel Plan'}
                </button>
            )}
            {canRestart && (
                <button type="button" onClick={() => confirmRestart(plan, onRestart)} disabled={isRestarting}
                    className="px-4 py-2 text-sm font-medium text-violet-400 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/30 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                    {isRestarting ? 'Publishing...' : plan.status === 'draft' ? 'Publish' : 'Restart Poll'}
                </button>
            )}
        </div>
    );
}

function PollResultsToggle({ plan }: { plan: EventPlanResponseDto }) {
    const [showResults, setShowResults] = useState(true);
    if (plan.status !== 'polling') return null;
    return (
        <div className="pt-2 border-t border-edge space-y-3">
            <button type="button" onClick={() => setShowResults((s) => !s)}
                className="flex items-center gap-1 text-sm text-violet-400 hover:text-violet-300 transition-colors">
                <svg className={`w-4 h-4 transition-transform ${showResults ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                {showResults ? 'Hide Results' : 'Show Results'}
            </button>
            {showResults && <PollResultsSection planId={plan.id} />}
        </div>
    );
}

function PlanCard({ plan, gameName, onCancel, isCancelling, onRestart, isRestarting, canManage }: {
    plan: EventPlanResponseDto; gameName: string | null;
    onCancel: (planId: string) => void; isCancelling: boolean;
    onRestart: (planId: string) => void; isRestarting: boolean; canManage: boolean;
}) {
    return (
        <div className="bg-panel border border-edge rounded-xl p-5 space-y-3">
            <PlanHeader plan={plan} gameName={gameName} />
            <PlanBadges plan={plan} />
            <PlanDetails plan={plan} />
            <PollResultsToggle plan={plan} />
            {plan.status === 'completed' && (
                <div className="pt-2 border-t border-edge"><CompletedResultsSection plan={plan} /></div>
            )}
            {canManage && <PlanActions plan={plan} onCancel={onCancel} isCancelling={isCancelling} onRestart={onRestart} isRestarting={isRestarting} />}
        </div>
    );
}

function PlansLoadingSkeleton() {
    return (
        <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="bg-panel border border-edge rounded-xl p-5 animate-pulse">
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

function PlansEmptyState() {
    return (
        <div className="text-center py-16">
            <svg className="w-12 h-12 mx-auto text-muted mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-muted text-lg mb-1">No event plans yet</p>
            <p className="text-muted/70 text-sm">Use Plan Event to poll your community for the best time.</p>
        </div>
    );
}

export function EventPlansList() {
    const { data: plans, isLoading, error } = useMyEventPlans();
    const { games } = useGameRegistry();
    const { user } = useAuth();
    const cancelMutation = useCancelEventPlan();
    const restartMutation = useRestartEventPlan();
    const isPrivileged = user?.role === 'admin' || user?.role === 'operator';

    const gameMap = useMemo(() => {
        const map = new Map<number, string>();
        for (const game of games) map.set(game.id, game.name);
        return map;
    }, [games]);

    if (isLoading) return <PlansLoadingSkeleton />;
    if (error) return <div className="text-center py-12"><p className="text-red-400">Failed to load plans: {error.message}</p></div>;
    if (!plans || plans.length === 0) return <PlansEmptyState />;

    return (
        <div className="space-y-4">
            {plans.map((plan) => (
                <PlanCard key={plan.id} plan={plan}
                    gameName={plan.gameId ? (gameMap.get(plan.gameId) ?? null) : null}
                    onCancel={(planId) => cancelMutation.mutate(planId)}
                    isCancelling={cancelMutation.isPending && cancelMutation.variables === plan.id}
                    onRestart={(planId) => restartMutation.mutate(planId)}
                    isRestarting={restartMutation.isPending && restartMutation.variables === plan.id}
                    canManage={isPrivileged || plan.creatorId === user?.id}
                />
            ))}
        </div>
    );
}
