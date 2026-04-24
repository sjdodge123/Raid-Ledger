/**
 * Admin panel for LLM-generated dynamic discovery categories (ROK-567).
 *
 * Tabs across pending / approved / rejected. Surfaces a "vectors not
 * ready" banner when every pending suggestion has an empty
 * candidateGameIds list — that's the heuristic used by the weekly cron
 * to indicate the pipeline ran before game_taste_vectors was populated.
 *
 * Mounted inside the Admin Settings > General panel so the route
 * `/admin/settings/general` surfaces it alongside Site Settings.
 */
import { useState, type JSX } from 'react';
import type {
    AdminCategoryListSuggestionDto,
    DiscoveryCategorySuggestionDto,
    SuggestionStatus,
} from '@raid-ledger/contract';
import {
    useApproveDynamicCategory,
    useListDynamicCategories,
    usePatchDynamicCategory,
    useRegenerateDynamicCategories,
    useRejectDynamicCategory,
} from '../../hooks/admin/use-dynamic-categories';
import {
    useAiFeatures,
    useUpdateAiFeatures,
} from '../../hooks/admin/use-ai-settings';
import { toast } from '../../lib/toast';
import { DynamicCategoryCard } from '../../components/admin/DynamicCategoryCard';
import { DynamicCategoryEditModal } from '../../components/admin/DynamicCategoryEditModal';

const TABS: { key: SuggestionStatus; label: string }[] = [
    { key: 'pending', label: 'Pending' },
    { key: 'approved', label: 'Approved' },
    { key: 'rejected', label: 'Rejected' },
];

function TabBar({
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

function LoadingSkeleton() {
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

function VectorsNotReadyBanner() {
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

function EmptyPending({
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
                className="px-3 py-1.5 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 text-foreground rounded-lg transition-colors"
            >
                {isRegenerating ? 'Regenerating…' : 'Regenerate'}
            </button>
        </div>
    );
}

function EmptyGeneric() {
    return (
        <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 text-center">
            <p className="text-sm text-muted">Nothing here yet.</p>
        </div>
    );
}

function useCategoryActions(onError: (msg: string) => void) {
    const approve = useApproveDynamicCategory();
    const reject = useRejectDynamicCategory();
    const patch = usePatchDynamicCategory();
    const regenerate = useRegenerateDynamicCategories();
    const runApprove = (id: string) =>
        approve.mutate(id, {
            onError: (e) => onError(e.message),
        });
    const runReject = (id: string) =>
        reject.mutate(
            { id },
            {
                onError: (e) => onError(e.message),
            },
        );
    const runRegenerate = () =>
        regenerate.mutate(undefined, {
            onSuccess: (res) => {
                if (res.inserted === 0 && res.expired === 0) {
                    toast.info('Regenerate ran — no new suggestions produced.');
                } else {
                    toast.success(
                        `Generated ${res.inserted} new suggestion${res.inserted === 1 ? '' : 's'}${res.expired > 0 ? ` · expired ${res.expired}` : ''}`,
                    );
                }
            },
            onError: (e) => onError(e.message),
        });
    return { approve, reject, patch, regenerate, runApprove, runReject, runRegenerate };
}

interface CardsListProps {
    items: AdminCategoryListSuggestionDto[];
    onApprove: (id: string) => void;
    onReject: (id: string) => void;
    onEdit: (s: DiscoveryCategorySuggestionDto) => void;
    isBusy: boolean;
}

function CardsList({ items, onApprove, onReject, onEdit, isBusy }: CardsListProps) {
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

function vectorsNotReady(
    status: SuggestionStatus,
    items: AdminCategoryListSuggestionDto[] | undefined,
): boolean {
    if (status !== 'pending') return false;
    if (!items || items.length === 0) return false;
    return items.every((s) => s.candidateGameIds.length === 0);
}

function Header({
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
                className="px-3 py-1.5 text-sm font-medium bg-overlay hover:bg-faint text-foreground border border-edge rounded-lg transition-colors disabled:opacity-50"
            >
                {isRegenerating ? 'Regenerating…' : 'Regenerate'}
            </button>
        </div>
    );
}

function PanelBody({
    status,
    list,
    actions,
    setEditing,
}: {
    status: SuggestionStatus;
    list: ReturnType<typeof useListDynamicCategories>;
    actions: ReturnType<typeof useCategoryActions>;
    setEditing: (s: DiscoveryCategorySuggestionDto | null) => void;
}): JSX.Element {
    const items = list.data?.suggestions ?? [];
    const isBusy =
        actions.approve.isPending ||
        actions.reject.isPending ||
        actions.patch.isPending;
    if (list.isLoading) return <LoadingSkeleton />;
    if (items.length === 0) {
        return status === 'pending' ? (
            <EmptyPending
                onRegenerate={actions.runRegenerate}
                isRegenerating={actions.regenerate.isPending}
            />
        ) : (
            <EmptyGeneric />
        );
    }
    return (
        <CardsList
            items={items}
            onApprove={actions.runApprove}
            onReject={actions.runReject}
            onEdit={setEditing}
            isBusy={isBusy}
        />
    );
}

function FeatureToggle({
    enabled,
    disabled,
    onChange,
}: {
    enabled: boolean;
    disabled: boolean;
    onChange: (v: boolean) => void;
}): JSX.Element {
    const btnCls = `relative w-11 h-6 rounded-full transition-colors ${
        enabled ? 'bg-emerald-600' : 'bg-overlay'
    } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`;
    return (
        <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Enable dynamic discovery categories"
            disabled={disabled}
            onClick={() => onChange(!enabled)}
            className={btnCls}
        >
            <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-foreground transition-transform ${
                    enabled ? 'translate-x-5' : ''
                }`}
            />
        </button>
    );
}

export function DynamicCategoriesPanel(): JSX.Element {
    const features = useAiFeatures();
    const updateFeatures = useUpdateAiFeatures();
    const enabled = features.data?.dynamicCategoriesEnabled ?? false;
    const [status, setStatus] = useState<SuggestionStatus>('pending');
    const [editing, setEditing] =
        useState<DiscoveryCategorySuggestionDto | null>(null);
    const list = useListDynamicCategories(status);
    const actions = useCategoryActions(toast.error);
    const showVectorsBanner = vectorsNotReady(status, list.data?.suggestions);

    const handleSaveEdit = async (
        id: string,
        patch: { name?: string; description?: string },
    ) => {
        await actions.patch.mutateAsync(
            { id, patch },
            {
                onError: (e) => toast.error(e.message),
                onSuccess: () => {
                    toast.success('Category updated');
                    setEditing(null);
                },
            },
        );
    };

    return (
        <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 space-y-4">
            <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                    <h2 className="text-xl font-semibold text-foreground">
                        Dynamic Categories
                    </h2>
                    <p className="text-sm text-muted mt-1">
                        Review LLM-generated discovery rows before they ship to
                        the /games page.
                    </p>
                </div>
                <FeatureToggle
                    enabled={enabled}
                    disabled={updateFeatures.isPending || features.isLoading}
                    onChange={(v) =>
                        updateFeatures.mutate({ dynamicCategoriesEnabled: v })
                    }
                />
            </div>
            {enabled && (
                <>
                    <Header
                        onRegenerate={actions.runRegenerate}
                        isRegenerating={actions.regenerate.isPending}
                    />
                    <TabBar active={status} onSelect={setStatus} />
                    {showVectorsBanner && <VectorsNotReadyBanner />}
                    <PanelBody
                        status={status}
                        list={list}
                        actions={actions}
                        setEditing={setEditing}
                    />
                    <DynamicCategoryEditModal
                        isOpen={!!editing}
                        suggestion={editing}
                        onClose={() => setEditing(null)}
                        onSave={handleSaveEdit}
                        isSaving={actions.patch.isPending}
                    />
                </>
            )}
        </div>
    );
}
