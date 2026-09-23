/**
 * Overlay + container primitives for /dev/design-system (ROK-1539):
 * Modal, BottomSheet, ScrollCollapsible, NavChip, CopyButton, MarkdownText,
 * and the FAB. Interactive examples mount the real components; the FAB is
 * reproduced statically because the real one is `position: fixed` + `md:hidden`
 * and would float over the whole reference page.
 */
import { useState, type JSX } from 'react';
import { PlusIcon } from '@heroicons/react/24/solid';
import { Modal } from '../../components/ui/modal';
import { BottomSheet } from '../../components/ui/bottom-sheet';
import { ScrollCollapsible } from '../../components/ui/scroll-collapsible';
import { NavChip } from '../../components/ui/nav-chip';
import { CopyButton } from '../../components/ui/CopyButton';
import { MarkdownText } from '../../components/ui/markdown-text';
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
            blurb="Modal / BottomSheet / ScrollCollapsible / NavChip / CopyButton / MarkdownText / FAB. Buttons below open the real components."
        >
            <StateGrid>
                <ModalDemo />
                <BottomSheetDemo />
                <CollapsibleDemo />
                <ChipsAndText />
                <FabStatic />
            </StateGrid>
        </Section>
    );
}
