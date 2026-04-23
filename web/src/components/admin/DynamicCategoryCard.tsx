/**
 * Admin card for a single LLM-proposed discovery category (ROK-567).
 *
 * Shows name, description, a compact 7-axis theme-vector strip, a short
 * candidate-game summary, and action buttons (Approve / Reject / Edit).
 *
 * The status is reflected on the root element via `data-status` so the
 * Playwright smoke test can poll for transitions without relying on
 * re-fetch timing.
 */
import type { JSX } from 'react';
import type { DiscoveryCategorySuggestionDto } from '@raid-ledger/contract';

/** Axis order is locked by contract: [co_op, pvp, rpg, survival, strategy, social, mmo]. */
const AXIS_LABELS = ['Co-op', 'PvP', 'RPG', 'Surv', 'Strat', 'Social', 'MMO'];

interface DynamicCategoryCardProps {
    suggestion: DiscoveryCategorySuggestionDto;
    onApprove?: (id: string) => void;
    onReject?: (id: string) => void;
    onEdit?: (suggestion: DiscoveryCategorySuggestionDto) => void;
    isBusy?: boolean;
}

function ThemeStrip({ vector }: { vector: number[] }) {
    return (
        <div
            className="flex items-end gap-1 h-12"
            role="img"
            aria-label={`Theme vector: ${vector
                .map((v, i) => `${AXIS_LABELS[i]} ${v.toFixed(2)}`)
                .join(', ')}`}
        >
            {vector.slice(0, 7).map((raw, i) => {
                const mag = Math.min(1, Math.abs(raw));
                const heightPct = Math.max(6, Math.round(mag * 100));
                return (
                    <div
                        key={AXIS_LABELS[i]}
                        className="flex flex-col items-center flex-1 min-w-0"
                    >
                        <div
                            className={`w-full rounded-t ${raw >= 0 ? 'bg-emerald-500/70' : 'bg-red-500/70'}`}
                            style={{ height: `${heightPct}%` }}
                        />
                        <span className="text-[10px] text-muted truncate mt-1">
                            {AXIS_LABELS[i]}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}

function CandidateSummary({ ids }: { ids: number[] }) {
    if (ids.length === 0) {
        return (
            <p className="text-xs text-amber-400">
                No candidate games matched — likely waiting on taste vectors.
            </p>
        );
    }
    return (
        <p className="text-xs text-muted">
            {`${ids.length} candidate game${ids.length === 1 ? '' : 's'}`}
        </p>
    );
}

function ActionButtons({
    suggestion,
    onApprove,
    onReject,
    onEdit,
    isBusy,
}: DynamicCategoryCardProps): JSX.Element {
    const disabled = isBusy || suggestion.status !== 'pending';
    return (
        <div className="flex flex-wrap gap-2 mt-3">
            <button
                type="button"
                onClick={() => onApprove?.(suggestion.id)}
                disabled={disabled}
                className="px-3 py-1.5 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-foreground rounded-lg transition-colors"
            >
                Approve
            </button>
            <button
                type="button"
                onClick={() => onReject?.(suggestion.id)}
                disabled={disabled}
                className="px-3 py-1.5 text-sm font-medium bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-600/50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
                Reject
            </button>
            <button
                type="button"
                onClick={() => onEdit?.(suggestion)}
                disabled={isBusy}
                className="px-3 py-1.5 text-sm font-medium bg-overlay hover:bg-faint text-foreground border border-edge rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
                Edit
            </button>
        </div>
    );
}

export function DynamicCategoryCard(
    props: DynamicCategoryCardProps,
): JSX.Element {
    const { suggestion } = props;
    return (
        <div
            data-testid="dynamic-category-card"
            data-status={suggestion.status}
            className="bg-panel/50 rounded-xl border border-edge/50 p-4 space-y-3"
        >
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <h3 className="text-base font-semibold text-foreground truncate">
                        {suggestion.name}
                    </h3>
                    <p className="text-sm text-muted mt-1 line-clamp-3">
                        {suggestion.description}
                    </p>
                </div>
                <span className="text-xs uppercase tracking-wider text-muted shrink-0">
                    {suggestion.categoryType.replace('_', ' ')}
                </span>
            </div>
            <ThemeStrip vector={suggestion.themeVector} />
            <CandidateSummary ids={suggestion.candidateGameIds} />
            <ActionButtons {...props} />
        </div>
    );
}
