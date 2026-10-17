/**
 * ROK-1786/ROK-1830 — "Recommended addons" (prototype `RecommendedAddons.tsx`):
 * pinned rows first (from the setting, never editable), then the guild's own
 * list, filtered by flavor. Editors add by pasting a link, edit, remove and
 * reorder (the full id list is PUT back).
 *
 * Addon flavors are a WoW concept, so the panel lives in this plugin and is
 * contributed as a source of core's "Recommended mods" frame through
 * `HubModule.modSources` (ROK-1830 S5b — the frame owns the heading and the
 * blurb now, so the panel no longer draws its own `SectionTitle`).
 */
import { useState, type JSX } from 'react';
import type { GuildAddonList } from '@raid-ledger/contract';
import { RadioGroup } from '../../../components/ui/radio-group';
import { AddAddonForm, type NewAddon } from './addon-form';
import { AddonRow, type RowActions } from './addon-row';
import {
    guildAddonMatches, guildAddonView, pinnedAddonView, pinnedMatches, reorderedIds, type FlavorFilter,
} from './addon-view';
import { useGuildAddonMutations, useGuildAddons } from '../../../components/hub/api/use-guild-content';
import type { HubResourceCtx } from '../../hub-module';

const FILTER_OPTIONS = [
    { value: 'any', label: 'All' },
    { value: 'classic', label: 'Classic' },
    { value: 'forever', label: 'Forever' },
    { value: 'retail', label: 'Retail' },
] as const;

function useAddonActions(guildId: number, list: GuildAddonList, visible: ReadonlySet<number>) {
    const m = useGuildAddonMutations(guildId);
    const [listError, setListError] = useState<string | null>(null);
    const report = (what: string) => ({
        onSuccess: () => setListError(null),
        onError: (e: Error) => setListError(`Couldn’t ${what} that addon. ${e.message}`),
    });
    const actions: RowActions = {
        onMove: (id, dir) => { const ids = reorderedIds(list.addons, id, dir, visible); if (ids) m.reorder.mutate(ids, report('move')); },
        onSave: (id, d, callbacks) => m.update.mutate(
            { id, input: { note: d.note.trim() || null, requirement: d.requirement, flavor: d.flavor } }, callbacks,
        ),
        onRemove: (id) => m.remove.mutate(id, report('remove')),
    };
    const add = (a: NewAddon, reset: () => void): void => m.add.mutate(
        { url: a.url, note: a.note.trim() || null, requirement: a.requirement, flavor: a.flavor }, { onSuccess: reset },
    );
    return { actions, add, adding: m.add.isPending, addFailure: m.add.error?.message ?? null, listError };
}

/**
 * The Resources-tab section. Core no longer runs this query, so pending and
 * failed are answered here: a bare `null` conflated them and took the whole
 * panel (an editor's Add form included) away with nothing said.
 */
export function GuildAddonsSection({ guildId, canEdit }: HubResourceCtx): JSX.Element {
    const addons = useGuildAddons(guildId);
    if (addons.error) {
        return (
            <p className="py-8 text-center text-sm text-muted" data-testid="guild-addons-load-error">
                We couldn&apos;t load this guild&apos;s recommended addons. Try again in a moment.
            </p>
        );
    }
    if (!addons.data) {
        return <div className="h-20 animate-pulse rounded-lg border border-edge bg-surface" aria-busy="true" data-testid="guild-addons-loading" />;
    }
    return <GuildAddons guildId={guildId} list={addons.data} canEdit={canEdit} />;
}

function GuildAddons({ guildId, list, canEdit }: { guildId: number; list: GuildAddonList; canEdit: boolean }): JSX.Element {
    const [filter, setFilter] = useState<FlavorFilter>('any');
    const visible = list.addons.filter((a) => guildAddonMatches(a, filter));
    const { actions, add, adding, addFailure, listError } = useAddonActions(guildId, list, new Set(visible.map((a) => a.id)));
    const pinned = list.pinned.filter((p) => pinnedMatches(p, filter));
    return (
        <section id="addons" className="scroll-mt-4" data-testid="guild-addons">
            <RadioGroup label="Flavor" hideLabel appearance="segmented" options={FILTER_OPTIONS} value={filter} onChange={setFilter} className="mb-4" />
            {canEdit && <div className="mb-4"><AddAddonForm onAdd={add} pending={adding} failure={addFailure} /></div>}
            {listError && <p role="alert" data-testid="guild-addons-error" className="mb-3 text-sm text-danger">{listError}</p>}
            <ul className="flex flex-col gap-2" aria-label="Recommended addons">
                {pinned.map((p, i) => <AddonRow key={`p-${i}`} addon={pinnedAddonView(p, i)} canEdit={canEdit} actions={actions} isFirst isLast />)}
                {visible.map((a, i) => (
                    <AddonRow key={a.id} addon={guildAddonView(a)} canEdit={canEdit} actions={actions} isFirst={i === 0} isLast={i === visible.length - 1}
                        details={{ note: a.note ?? '', requirement: a.requirement, flavor: a.flavor }} />
                ))}
            </ul>
            {visible.length === 0 && <p className="mt-3 text-sm text-muted">No guild addons for this flavor yet.</p>}
        </section>
    );
}
