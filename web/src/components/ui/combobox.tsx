/**
 * Combobox — the shared autocomplete (ROK-1646, spike ROK-1644 §4.7; operator
 * ruling: in-house, no headless library). WAI-ARIA 1.2 combobox pattern.
 *
 * - An `Input` with `role="combobox"`, `aria-expanded`, `aria-controls`,
 *   `aria-activedescendant` and `aria-autocomplete="list"`; focus never leaves
 *   it. Inherits the field frame, 16px text below `lg`, the `ring-success/80`
 *   focus ring and `Field` context wiring.
 * - A `role="listbox"` of `role="option"` rows (`aria-selected` = `value`),
 *   portalled to `<body>` under the input so Modal / BottomSheet overflow
 *   can't clip it; closes on an outside press; keeps the active row in view.
 * - Keyboard contract: `use-combobox.ts`. Positioning: `use-anchored-popup.ts`.
 * - Async: `loading` / `emptyText` / `errorText` render a `role="status"` row.
 */
import { useRef, type JSX } from 'react';
import { Input } from './input';
import { ComboboxPopup } from './combobox-popup';
import { useCombobox } from './use-combobox';
import { useAnchoredPopup, useScrollIntoView } from './use-anchored-popup';
import type { ComboboxProps } from './combobox-types';

export type { ComboboxProps, ComboboxOptionState } from './combobox-types';

/** The shared combobox. See the file header for the contract. */
export function Combobox<T>(p: ComboboxProps<T>): JSX.Element {
    const c = useCombobox(p);
    const anchorRef = useRef<HTMLDivElement>(null);
    const popupRef = useRef<HTMLDivElement>(null);
    const pos = useAnchoredPopup(anchorRef, popupRef, c.open, c.close);
    const activeId = c.activeIndex >= 0 ? c.optionId(c.activeIndex) : undefined;
    useScrollIntoView(activeId);
    const selectedKey = p.value ? p.getKey(p.value) : null;
    return (
        <div ref={anchorRef} className={p.className ?? 'w-full'}>
            <Input
                role="combobox" aria-label={p.label} aria-expanded={c.open} aria-controls={c.listboxId}
                aria-activedescendant={activeId} aria-autocomplete="list" autoComplete="off"
                id={p.id} name={p.name} placeholder={p.placeholder} disabled={p.disabled} autoFocus={p.autoFocus}
                invalid={p.invalid} fieldSize={p.fieldSize} value={c.text}
                onChange={(e) => c.onInputChange(e.target.value)} onKeyDown={c.onKeyDown} onBlur={c.close}
            />
            {c.open && (
                <ComboboxPopup
                    popupRef={popupRef} pos={pos} listboxId={c.listboxId} label={p.label}
                    items={c.items} status={c.status} activeIndex={c.activeIndex} optionId={c.optionId}
                    isSelected={(o) => p.getKey(o) === selectedKey} getKey={p.getKey}
                    render={p.renderOption ?? ((o) => <span className="truncate">{p.getLabel(o)}</span>)}
                    onHover={c.setActive} onPick={c.select}
                />
            )}
        </div>
    );
}
