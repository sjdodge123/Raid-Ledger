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
import { useAiFeatures } from '../../hooks/admin/use-ai-settings';
import { toast } from '../../lib/toast';
import { DynamicCategoryEditModal } from '../../components/admin/DynamicCategoryEditModal';
import {
    Header,
    LoadingSkeleton,
    PanelEmptyState,
    PanelHeading,
    TabBar,
    CardsList,
    VectorsNotReadyBanner,
} from './dynamic-categories-panel-parts';

import { SkeletonList } from './dynamic-categories-skeletons';

/** Toast copy for a finished regenerate pass — counts, or an info fallback. */
function reportRegenerate(res: { inserted: number; expired: number }): void {
    if (res.inserted === 0 && res.expired === 0) {
        toast.info('Regenerate ran — no new suggestions produced.');
        return;
    }
    const plural = res.inserted === 1 ? '' : 's';
    const expired = res.expired > 0 ? ` · expired ${res.expired}` : '';
    toast.success(
        `Generated ${res.inserted} new suggestion${plural}${expired}`,
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
            onSuccess: reportRegenerate,
            onError: (e) => onError(e.message),
        });
    return { approve, reject, patch, regenerate, runApprove, runReject, runRegenerate };
}

/**
 * True while a per-card mutation is in flight — the cards disable their
 * buttons off this rather than each tracking the three mutations (D3).
 */
function useBusyState(actions: ReturnType<typeof useCategoryActions>): boolean {
    return (
        actions.approve.isPending ||
        actions.reject.isPending ||
        actions.patch.isPending
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

interface PanelBodyProps {
    status: SuggestionStatus;
    list: ReturnType<typeof useListDynamicCategories>;
    actions: ReturnType<typeof useCategoryActions>;
    setEditing: (s: DiscoveryCategorySuggestionDto | null) => void;
}

/**
 * Loading / regenerating / empty view for the active tab, or `null` when
 * there are cards to render (ROK-1530 D3).
 */
function panelPlaceholder(
    { status, list, actions }: PanelBodyProps,
    items: AdminCategoryListSuggestionDto[],
): JSX.Element | null {
    const isRegenerating = actions.regenerate.isPending;
    if (list.isLoading) return <LoadingSkeleton />;
    // Regenerate pass replaces the pending view with skeleton cards so
    // operators get immediate feedback that the LLM is working.
    if (isRegenerating && status === 'pending') {
        return <SkeletonList count={Math.max(items.length, 3)} />;
    }
    if (items.length > 0) return null;
    return (
        <PanelEmptyState
            status={status}
            onRegenerate={actions.runRegenerate}
            isRegenerating={isRegenerating}
        />
    );
}

function PanelBody(props: PanelBodyProps): JSX.Element {
    const { actions, setEditing } = props;
    const items = props.list.data?.suggestions ?? [];
    const isBusy = useBusyState(actions);
    const placeholder = panelPlaceholder(props, items);
    if (placeholder) return placeholder;
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

/**
 * Edit-modal save handler, hoisted out of `DynamicCategoriesPanel` (D2).
 * `onSaved` closes the modal; errors surface as a toast and keep it open.
 */
function useSaveEdit(
    actions: ReturnType<typeof useCategoryActions>,
    onSaved: () => void,
) {
    return async (
        id: string,
        patch: { name?: string; description?: string },
    ): Promise<void> => {
        await actions.patch.mutateAsync(
            { id, patch },
            {
                onError: (e) => toast.error(e.message),
                onSuccess: () => {
                    toast.success('Category updated');
                    onSaved();
                },
            },
        );
    };
}

/** Everything the panel needs: tab state, queries, mutations, save handler. */
function usePanelState() {
    const features = useAiFeatures();
    const [status, setStatus] = useState<SuggestionStatus>('pending');
    const [editing, setEditing] =
        useState<DiscoveryCategorySuggestionDto | null>(null);
    const list = useListDynamicCategories(status);
    const actions = useCategoryActions(toast.error);
    const handleSaveEdit = useSaveEdit(actions, () => setEditing(null));
    return {
        enabled: features.data?.dynamicCategoriesEnabled ?? false,
        status,
        setStatus,
        editing,
        setEditing,
        list,
        actions,
        handleSaveEdit,
        showVectorsBanner: vectorsNotReady(status, list.data?.suggestions),
    };
}

export function DynamicCategoriesPanel(): JSX.Element {
    const panel = usePanelState();
    const { actions, setEditing } = panel;

    if (!panel.enabled) return <></>;
    return (
        <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 space-y-4">
            <PanelHeading />
            <Header
                onRegenerate={actions.runRegenerate}
                isRegenerating={actions.regenerate.isPending}
            />
            <TabBar active={panel.status} onSelect={panel.setStatus} />
            {panel.showVectorsBanner && <VectorsNotReadyBanner />}
            <PanelBody
                status={panel.status}
                list={panel.list}
                actions={actions}
                setEditing={setEditing}
            />
            <DynamicCategoryEditModal
                isOpen={!!panel.editing}
                suggestion={panel.editing}
                onClose={() => setEditing(null)}
                onSave={panel.handleSaveEdit}
                isSaving={actions.patch.isPending}
            />
        </div>
    );
}
