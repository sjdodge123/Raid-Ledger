/**
 * ROK-1918 L5 — arrange mode (spec §2.3, Q1 A; mockup frames 1–4). While a
 * leader/officer/staff arranges, the bento grid becomes an order-truthful
 * list of every widget the viewer may see; hidden rows stay dimmed in place.
 * Lazy-loaded by `HubOverview` (default export) so none of this lands in the
 * `hub-page` route chunk. Cancel with unsaved changes asks first
 * (`useDirtyCloseGuard` → `DiscardChangesConfirm`); so does Reset to default.
 */
import { useState, type JSX } from 'react';
import { PlusIcon } from '@heroicons/react/24/outline';
import type { HubWidgetPrefs } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { DiscardChangesConfirm } from '../../ui/discard-changes-confirm';
import { useDirtyCloseGuard } from '../../../hooks/use-dirty-close-guard';
import { useMediaQuery } from '../../../hooks/use-media-query';
import type { ArrangedEntry, HubLayoutEntry } from '../layout/resolve-hub-layout';
import { AddWidgetPicker } from './add-widget-picker';
import { ArrangeFooter } from './arrange-footer';
import { ArrangeRow } from './arrange-row';
import { useArrangeState } from './use-arrange-state';
import { DRAG_MQ, useRowDrag } from './use-row-drag';
import { widgetOwner } from './widget-owner';

export interface HubArrangeModeProps {
    guildId: number;
    /** The hub kind — module widgets are owned by whichever plugin registered it. */
    kind: string;
    arranged: readonly ArrangedEntry<HubLayoutEntry>[];
    available: readonly HubLayoutEntry[];
    prefs: HubWidgetPrefs | null;
    onExit: () => void;
}

const RESET_COPY = { title: 'Restore the default layout?', keepLabel: 'Cancel', discardLabel: 'Reset' };

function ArrangeHeader({ onAdd, canDrag }: { onAdd: () => void; canDrag: boolean }): JSX.Element {
    return (
        <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div>
                <h3 className="text-base font-semibold text-foreground">Arrange the Overview</h3>
                <p className="text-sm text-muted">{canDrag ? 'Drag a row or use the arrows.' : 'Use the arrows to move a card.'} Wide cards may move up to fill gaps. Hidden cards stay here, dimmed.</p>
            </div>
            <Button variant="secondary" size="sm" onClick={onAdd} className="w-full lg:w-auto" data-testid="arrange-add">
                <PlusIcon className="h-4 w-4" aria-hidden="true" />Add widget
            </Button>
        </div>
    );
}

/** ≥1024px: what members will see, in this order (mockup frame 1, right). */
function ArrangePreview({ entries }: { entries: readonly HubLayoutEntry[] }): JSX.Element {
    return (
        <aside className="hidden rounded-lg border border-edge bg-panel p-3 lg:block" aria-label="Preview">
            <h4 className="text-sm font-semibold text-foreground">Preview</h4>
            <p className="mb-2 text-xs text-muted">What members will see, in this order.</p>
            <ol className="grid grid-cols-2 gap-1.5">
                {entries.map((e) => <li key={e.id} className="truncate rounded border border-edge bg-surface px-2 py-1 text-xs text-secondary">{e.title}</li>)}
            </ol>
        </aside>
    );
}

export default function HubArrangeMode({ guildId, kind, arranged, available, prefs, onExit }: HubArrangeModeProps): JSX.Element {
    const s = useArrangeState({ guildId, arranged, prefs, onExit });
    const guard = useDirtyCloseGuard(s.dirty, onExit);
    const [picking, setPicking] = useState(false);
    const [confirmReset, setConfirmReset] = useState(false);
    const canDrag = useMediaQuery(DRAG_MQ);
    const bindDrag = useRowDrag(s.drop);
    const options = available.filter((e) => !s.rows.some((r) => r.entry.id === e.id));
    return (
        <section data-testid="hub-arrange-mode" aria-label="Arrange the Overview">
            <ArrangeHeader onAdd={() => setPicking(true)} canDrag={canDrag} />
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
                <ol ref={s.bindList} className="flex flex-col gap-2" aria-label="Overview widgets, in order">
                    {s.rows.map((row, i) => <ArrangeRow key={row.entry.id} row={row} index={i} count={s.rows.length} owner={widgetOwner(row.entry.id, kind)} onMove={s.move} onToggle={s.toggle} {...(canDrag ? { drag: bindDrag(i) } : {})} />)}
                </ol>
                <ArrangePreview entries={s.rows.filter((r) => r.on).map((r) => r.entry)} />
            </div>
            <p className="sr-only" aria-live="polite" data-testid="arrange-live">{s.live}</p>
            <ArrangeFooter dirty={s.dirty} saving={s.saving} error={s.error}
                onReset={() => setConfirmReset(true)} onCancel={guard.requestClose} onSave={s.save} />
            <AddWidgetPicker isOpen={picking} onClose={() => setPicking(false)} options={options}
                onAdd={(e) => { s.add(e); setPicking(false); }} />
            <DiscardChangesConfirm isOpen={guard.confirming} onKeep={guard.keep} onDiscard={guard.discard}
                message="Your layout changes haven't been saved yet." />
            <DiscardChangesConfirm isOpen={confirmReset} onKeep={() => setConfirmReset(false)} copy={RESET_COPY}
                onDiscard={() => { setConfirmReset(false); s.reset(); }}
                message="Every widget goes back to its default place, and added widgets are removed." />
        </section>
    );
}
