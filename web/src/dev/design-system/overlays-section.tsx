/**
 * Overlay + container primitives for /dev/design-system (ROK-1539):
 * Modal, BottomSheet, ScrollCollapsible, NavChip, CopyButton, MarkdownText,
 * and the FAB. ROK-1655 adds the pinned `footer` and the dirty-close
 * `closeGuard` (`useDirtyCloseGuard`) on both Modal and BottomSheet: type in
 * the form demos, then press Esc, tap the backdrop, × or Cancel to see
 * "Discard your changes?". ROK-1648 L13: each form demo also opens as a long
 * form (~25 filler rows) so the body scrolls under the pinned footer without
 * browser zoom. Interactive examples mount the real components; the FAB is
 * reproduced statically because the real one is `position: fixed` + `md:hidden`
 * and would float over the whole reference page.
 */
import { useCallback, useState, type JSX } from 'react';
import { PlusIcon } from '@heroicons/react/24/solid';
import { Modal } from '../../components/ui/modal';
import { BottomSheet } from '../../components/ui/bottom-sheet';
import { ScrollCollapsible } from '../../components/ui/scroll-collapsible';
import { NavChip } from '../../components/ui/nav-chip';
import { CopyButton } from '../../components/ui/CopyButton';
import { MarkdownText } from '../../components/ui/markdown-text';
import { Button } from '../../components/ui/button';
import { Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { useDirtyCloseGuard, type DirtyCloseGuard } from '../../hooks/use-dirty-close-guard';
import { Section, StateFrame, StateGrid } from './design-system-bits';

const DEMO_BTN = 'px-3 py-2 rounded-lg text-sm font-medium bg-panel border border-edge text-secondary hover:bg-overlay transition-colors';

function ModalDemo(): JSX.Element {
    const [open, setOpen] = useState(false);
    return (
        <StateFrame label="Modal — closed / open" note="Portalled, focus-trapped, ARIA dialog. Desktop only — pair with BottomSheet below 768px.">
            <button type="button" className={DEMO_BTN} onClick={() => setOpen(true)}>Open modal</button>
            <Modal isOpen={open} onClose={() => setOpen(false)} title="Example dialog">
                <p className="text-sm text-secondary">
                    Body content sits here at text-sm. The title row and close affordance come from the component.
                </p>
            </Modal>
        </StateFrame>
    );
}

function BottomSheetDemo(): JSX.Element {
    const [open, setOpen] = useState(false);
    return (
        <StateFrame label="BottomSheet — closed / open" note="The mobile counterpart. FilterPanel swaps to this below 768px automatically.">
            <button type="button" className={DEMO_BTN} onClick={() => setOpen(true)}>Open sheet</button>
            <BottomSheet isOpen={open} onClose={() => setOpen(false)} title="Filters">
                <p className="text-sm text-secondary">Sheet body — drag down or tap the backdrop to dismiss.</p>
            </BottomSheet>
        </StateFrame>
    );
}

interface GuardedDraft {
    open: boolean;
    /** Which variant the last trigger opened: the long form adds the filler rows. */
    long: boolean;
    show: () => void;
    showLong: () => void;
    draft: string;
    setDraft: (next: string) => void;
    close: () => void;
    guard: DirtyCloseGuard;
}

/**
 * Open state + a one-field draft; dirty while the draft is non-empty. The consumer owns the guard.
 * One overlay per demo serves both variants — a closed BottomSheet stays mounted, so a second
 * sheet would duplicate its Note field and footer in the DOM.
 */
function useGuardedDraft(): GuardedDraft {
    const [open, setOpen] = useState(false);
    const [long, setLong] = useState(false);
    const [draft, setDraft] = useState('');
    const close = useCallback(() => { setOpen(false); setDraft(''); }, []);
    const guard = useDirtyCloseGuard(draft !== '', close);
    const showAs = (asLong: boolean) => () => { setLong(asLong); setOpen(true); };
    return { open, long, show: showAs(false), showLong: showAs(true), draft, setDraft, close, guard };
}

function NoteField({ draft, onChange }: { draft: string; onChange: (next: string) => void }): JSX.Element {
    return (
        <Field label="Note" hint="Type, then press Esc, tap the backdrop, × or Cancel." className="w-full">
            <Input value={draft} onChange={(e) => onChange(e.target.value)} />
        </Field>
    );
}

const FILLER_LABELS = Array.from({ length: 25 }, (_, i) => `Filler field ${i + 1}`);

/** ~25 inert Field + Input rows: enough to overflow the 90dvh cap on any screen. */
function LongFiller(): JSX.Element {
    return (
        <div className="mt-4 flex flex-col gap-3" data-testid="ds-long-filler">
            {FILLER_LABELS.map((label) => (
                <Field key={label} label={label} className="w-full">
                    <Input placeholder="Filler — scroll to check the footer stays put" />
                </Field>
            ))}
        </div>
    );
}

/** The Note field, plus the filler rows in the long variant. */
function DraftBody({ d }: { d: GuardedDraft }): JSX.Element {
    return (
        <>
            <NoteField draft={d.draft} onChange={d.setDraft} />
            {d.long ? <LongFiller /> : null}
        </>
    );
}

const draftTitle = (d: GuardedDraft): string => (d.long ? 'Edit long note' : 'Edit note');

/** Cancel is guarded (requestClose); Save is not — it closes on purpose. */
function GuardedActions({ d }: { d: GuardedDraft }): JSX.Element {
    return (
        <>
            <Button variant="secondary" onClick={d.guard.requestClose}>Cancel</Button>
            <Button onClick={d.close}>Save</Button>
        </>
    );
}

function FormModalDemo(): JSX.Element {
    const d = useGuardedDraft();
    return (
        <StateFrame label="Modal — pinned footer + dirty-close guard" note="footer is a shrink-0 bar outside the scroll body (90dvh cap) — open the long form to scroll under it. closeGuard: Esc / backdrop / × / Cancel ask first; Save does not.">
            <Button variant="secondary" onClick={d.show}>Open form modal</Button>
            <Button variant="secondary" onClick={d.showLong}>Open long form modal</Button>
            <Modal isOpen={d.open} onClose={d.close} title={draftTitle(d)} closeGuard={d.guard} footer={<GuardedActions d={d} />}>
                <DraftBody d={d} />
            </Modal>
        </StateFrame>
    );
}

function FormSheetDemo(): JSX.Element {
    const d = useGuardedDraft();
    return (
        <StateFrame label="BottomSheet — pinned footer + dirty-close guard" note="Same contract as Modal; the long form scrolls under the footer. Swipe-down is guarded too. Browser back is out of scope.">
            <Button variant="secondary" onClick={d.show}>Open form sheet</Button>
            <Button variant="secondary" onClick={d.showLong}>Open long form sheet</Button>
            <BottomSheet isOpen={d.open} onClose={d.close} title={draftTitle(d)} closeGuard={d.guard} footer={<GuardedActions d={d} />}>
                <DraftBody d={d} />
            </BottomSheet>
        </StateFrame>
    );
}

function CollapsibleDemo(): JSX.Element {
    return (
        <StateFrame label="ScrollCollapsible — collapsed / expanded">
            <div className="w-full">
                <ScrollCollapsible title="Secondary detail">
                    <p className="text-sm text-secondary">Long secondary content that should not compete with the page's primary action.</p>
                </ScrollCollapsible>
            </div>
        </StateFrame>
    );
}

function ChipsAndText(): JSX.Element {
    return (
        <>
            <StateFrame label="NavChip" note="The ONLY navigational chip. Do not hand-write a <Link> with a pill className.">
                <NavChip to="/dev/design-system">Friday — Valheim</NavChip>
            </StateFrame>
            <StateFrame label="CopyButton — idle / copied" note="Shows a checkmark briefly, and toasts on failure in an insecure context.">
                <span className="text-xs text-secondary">ROK-1539</span>
                <CopyButton text="ROK-1539" />
            </StateFrame>
            <StateFrame label="MarkdownText" note="Allow-listed inline tokens only. Raw HTML is never rendered.">
                <MarkdownText text="**bold**, *italic*, `code`, and a [link](https://example.com)" />
            </StateFrame>
        </>
    );
}

function FabStatic(): JSX.Element {
    return (
        <StateFrame label="FAB — static replica" note="Real component is position:fixed + md:hidden (components/ui/fab.tsx). One primary create action per mobile page — a neutral-toned Filters FAB (design-system.md §4.1, ROK-1659) may stack directly above it, same right edge, 12px gap.">
            <span className="w-14 h-14 bg-emerald-600 text-white rounded-full shadow-lg shadow-emerald-500/25 flex items-center justify-center">
                <PlusIcon className="w-6 h-6" />
            </span>
        </StateFrame>
    );
}

/** Overlays and containers, each in its closed and open state. */
export function OverlaysSection(): JSX.Element {
    return (
        <Section
            id="overlays"
            title="Overlays and containers"
            blurb="Modal / BottomSheet (each with a pinned footer and the dirty-close guard) / ScrollCollapsible / NavChip / CopyButton / MarkdownText / FAB. Buttons below open the real components."
        >
            <div data-testid="ds-overlays">
                <StateGrid>
                    <ModalDemo />
                    <FormModalDemo />
                    <BottomSheetDemo />
                    <FormSheetDemo />
                    <CollapsibleDemo />
                    <ChipsAndText />
                    <FabStatic />
                </StateGrid>
            </div>
        </Section>
    );
}
