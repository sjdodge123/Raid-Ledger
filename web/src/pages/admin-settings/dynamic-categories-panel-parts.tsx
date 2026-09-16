/**
 * Presentational pieces of the Dynamic Categories admin panel (ROK-567).
 *
 * Split out of `dynamic-categories-panel.tsx` (ROK-1530 D2/D3) so that file
 * stays inside the 300-line budget. Behaviour-neutral: these are the same
 * components, moved.
 */
import type { JSX } from 'react';
import { SparklesIcon } from '@heroicons/react/24/outline';
import type {
    AdminCategoryListSuggestionDto,
    DiscoveryCategorySuggestionDto,
    SuggestionStatus,
} from '@raid-ledger/contract';
import { DynamicCategoryCard } from '../../components/admin/DynamicCategoryCard';

const TABS: { key: SuggestionStatus; label: string }[] = [
    { key: 'pending', label: 'Pending' },
    { key: 'approved', label: 'Approved' },
    { key: 'rejected', label: 'Rejected' },
];

export function TabBar({
    active,
    onSelect,
}: {
    active: SuggestionStatus;
    onSelect: (s: SuggestionStatus) => void;
}) {
    return (
        <div className="flex gap-1 border-b border-edge">
            {TABS.map((t) => (
                <button
                    key={t.key}
                    type="button"
                    onClick={() => onSelect(t.key)}
                    className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                        active === t.key
                            ? 'border-emerald-500 text-foreground'
                            : 'border-transparent text-muted hover:text-foreground'
                    }`}
                >
                    {t.label}
                </button>
            ))}
        </div>
    );
}

export function LoadingSkeleton() {
    return (
        <div className="space-y-3">
            {[0, 1].map((i) => (
                <div
                    key={i}
                    className="bg-panel/50 rounded-xl border border-edge/50 p-4 animate-pulse h-40"
                />
            ))}
        </div>
    );
}

export function VectorsNotReadyBanner() {
    return (
        <div
            data-testid="dynamic-categories-vectors-not-ready"
            className="bg-amber-500/10 border border-amber-500/30 text-amber-300 rounded-lg p-4 text-sm"
        >
            Game taste vectors are still computing. Cron will resume next Sunday
            once vectors are populated.
        </div>
    );
}

export function EmptyPending({
    onRegenerate,
    isRegenerating,
}: {
    onRegenerate: () => void;
    isRegenerating: boolean;
}) {
    return (
        <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 text-center space-y-3">
            <p className="text-sm text-muted">
                No suggestions yet. Click Regenerate to seed some.
            </p>
            <button
                type="button"
                onClick={onRegenerate}
                disabled={isRegenerating}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 text-foreground rounded-lg transition-colors"
            >
                <SparklesIcon
                    className={`h-4 w-4 ${isRegenerating ? 'animate-pulse' : ''}`}
                    aria-hidden
                />
                {isRegenerating ? 'Regenerating…' : 'Regenerate'}
            </button>
        </div>
    );
}

export function EmptyGeneric() {
    return (
        <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 text-center">
            <p className="text-sm text-muted">Nothing here yet.</p>
        </div>
    );
}

interface CardsListProps {
    items: AdminCategoryListSuggestionDto[];
    onApprove: (id: string) => void;
    onReject: (id: string) => void;
    onEdit: (s: DiscoveryCategorySuggestionDto) => void;
    isBusy: boolean;
}

export function CardsList({ items, onApprove, onReject, onEdit, isBusy }: CardsListProps) {
    return (
        <div className="space-y-3">
            {items.map((s) => (
                <DynamicCategoryCard
                    key={s.id}
                    suggestion={s}
                    onApprove={onApprove}
                    onReject={onReject}
                    onEdit={onEdit}
                    isBusy={isBusy}
                />
            ))}
        </div>
    );
}

export function Header({
    onRegenerate,
    isRegenerating,
}: {
    onRegenerate: () => void;
    isRegenerating: boolean;
}) {
    return (
        <div className="flex justify-end">
            <button
                type="button"
                onClick={onRegenerate}
                disabled={isRegenerating}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-overlay hover:bg-faint text-foreground border border-edge rounded-lg transition-colors disabled:opacity-50"
            >
                <SparklesIcon
                    className={`h-4 w-4 ${isRegenerating ? 'animate-pulse' : ''}`}
                    aria-hidden
                />
                {isRegenerating ? 'Regenerating…' : 'Regenerate'}
            </button>
        </div>
    );
}

/** Empty view for the active tab — only `pending` offers a Regenerate CTA (D3). */
export function PanelEmptyState({
    status,
    onRegenerate,
    isRegenerating,
}: {
    status: SuggestionStatus;
    onRegenerate: () => void;
    isRegenerating: boolean;
}): JSX.Element {
    if (status !== 'pending') return <EmptyGeneric />;
    return (
        <EmptyPending
            onRegenerate={onRegenerate}
            isRegenerating={isRegenerating}
        />
    );
}

/** Title + blurb above the tab bar (ROK-1530 D2). */
export function PanelHeading(): JSX.Element {
    return (
        <div>
            <h2 className="text-xl font-semibold text-foreground">
                Dynamic Categories
            </h2>
            <p className="text-sm text-muted mt-1">
                Review LLM-generated discovery rows before they ship to the
                /games page.
            </p>
        </div>
    );
}
