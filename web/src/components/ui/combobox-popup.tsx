/**
 * The Combobox popup (ROK-1646): portalled to `portalContainer` (the
 * surrounding dialog, else `<body>`) above Modal and BottomSheet (`Z_INDEX.MODAL + 1`), `bg-surface border-edge rounded-lg`, the
 * active row on `bg-overlay`, rows 44px below `lg`. A press inside it is
 * `preventDefault`ed so focus — and `aria-activedescendant` — stay on the input.
 * The visible status row is `aria-hidden`: the announcement comes from the ONE
 * persistent {@link ComboboxLiveRegion}, which is mounted even while closed.
 */
import type { CSSProperties, JSX, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Z_INDEX } from '../../lib/z-index';
import type { ComboboxOptionState, ComboboxStatus } from './combobox-types';
import type { PopupPosition } from './use-anchored-popup';

export interface ComboboxPopupProps<T> {
    popupRef: RefObject<HTMLDivElement | null>;
    pos: PopupPosition | null;
    listboxId: string;
    label?: string;
    /** The surrounding Field's label id, used when there is no `label`. */
    labelledBy?: string;
    items: T[];
    status?: ComboboxStatus;
    activeIndex: number;
    optionId: (index: number) => string;
    isSelected: (option: T) => boolean;
    getKey: (option: T) => string;
    render: (option: T, state: ComboboxOptionState) => ReactNode;
    onHover: (index: number) => void;
    onPick: (index: number) => void;
    /** `data-testid` for the popup container. */
    testId?: string;
    /** Portal target (default `document.body`). */
    portalContainer?: HTMLElement | null;
}

const POPUP = 'fixed max-h-64 overflow-y-auto bg-surface border border-edge rounded-lg shadow-xl py-1';

function optionClass(active: boolean, selected: boolean): string {
    return [
        'flex items-center gap-3 min-h-[44px] lg:min-h-9 px-3 py-2 cursor-pointer',
        'text-base lg:text-sm text-foreground',
        active ? 'bg-overlay' : '',
        selected ? 'font-medium' : '',
    ].filter(Boolean).join(' ');
}

function popupStyle(pos: PopupPosition | null): CSSProperties {
    return {
        zIndex: Z_INDEX.MODAL + 1,
        top: pos?.top ?? 0, left: pos?.left ?? 0, width: pos?.width,
        visibility: pos ? undefined : 'hidden',
    };
}

function StatusRow({ status }: { status: ComboboxStatus }): JSX.Element {
    const tone = status.tone === 'danger' ? 'text-danger' : 'text-muted';
    return <div aria-hidden="true" className={`px-3 py-3 text-sm ${tone}`}>{status.text}</div>;
}

/** The one live region: always mounted, only its text changes, so every update is announced. */
export function ComboboxLiveRegion({ text }: { text: string }): JSX.Element {
    return <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">{text}</div>;
}

/** The portalled listbox. Rendered only while the combobox is expanded. */
export function ComboboxPopup<T>({ popupRef, portalContainer, ...p }: ComboboxPopupProps<T>): JSX.Element {
    return createPortal(
        <div ref={popupRef} data-testid={p.testId} className={POPUP} style={popupStyle(p.pos)} onMouseDown={(e) => e.preventDefault()}>
            {p.status && <StatusRow status={p.status} />}
            <ul role="listbox" id={p.listboxId} aria-label={p.label} aria-labelledby={p.label ? undefined : p.labelledBy}>
                {p.items.map((o, i) => {
                    const state = { active: i === p.activeIndex, selected: p.isSelected(o) };
                    return (
                        <li key={p.getKey(o)} id={p.optionId(i)} role="option" aria-selected={state.selected}
                            className={optionClass(state.active, state.selected)}
                            onMouseMove={() => { if (!state.active) p.onHover(i); }} onClick={() => p.onPick(i)}>
                            {p.render(o, state)}
                        </li>
                    );
                })}
            </ul>
        </div>,
        portalContainer ?? document.body,
    );
}
