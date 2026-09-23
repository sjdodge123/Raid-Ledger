/**
 * Combobox — the shared autocomplete (ROK-1646, spike ROK-1644 §4.7; operator
 * ruling: in-house, no headless library). WAI-ARIA 1.2 combobox pattern.
 *
 * - An `Input` (ref forwarded) with `role="combobox"`, `aria-expanded`,
 *   `aria-controls` (only while open, so it never names a missing listbox),
 *   `aria-activedescendant` and `aria-autocomplete="list"`; focus never leaves
 *   it. Inherits the field frame, 16px text below `lg`, the `ring-success/80`
 *   focus ring and `Field` context wiring.
 * - A `role="listbox"` of `role="option"` rows (`aria-selected` = `value`),
 *   portalled under the input — into the surrounding `[role="dialog"]` when
 *   there is one (so `aria-modal` doesn't hide it), else `<body>`, or
 *   `portalContainer`; closes on an outside press; keeps the active row in view.
 * - Keyboard contract: `use-combobox.ts`. Positioning: `use-anchored-popup.ts`.
 * - Async: `loading` / `emptyText` / `errorText` render a status row, announced
 *   through one persistent `role="status"` region that is mounted even while closed.
 */
import { forwardRef, useRef, type ForwardedRef, type JSX, type Ref } from 'react';
import { Input } from './input';
import { useFieldContext } from './field-context';
import { ComboboxLiveRegion, ComboboxPopup } from './combobox-popup';
import { useCombobox } from './use-combobox';
import { useAnchoredPopup, usePortalTarget, useScrollIntoView } from './use-anchored-popup';
import type { ComboboxProps } from './combobox-types';

export type { ComboboxProps, ComboboxOptionState } from './combobox-types';

function ComboboxImpl<T>(p: ComboboxProps<T>, ref: ForwardedRef<HTMLInputElement>): JSX.Element {
    const c = useCombobox(p);
    const field = useFieldContext();
    const { anchorRef, setAnchorRef, container } = usePortalTarget(p.portalContainer);
    const popupRef = useRef<HTMLDivElement>(null);
    const pos = useAnchoredPopup(anchorRef, popupRef, c.open, c.close);
    const activeId = c.activeIndex >= 0 ? c.optionId(c.activeIndex) : undefined;
    useScrollIntoView(activeId);
    return (
        <div ref={setAnchorRef} className={p.className ?? 'w-full'}>
            <Input
                ref={ref} role="combobox" aria-label={p.label} aria-expanded={c.open} aria-controls={c.open ? c.listboxId : undefined}
                aria-activedescendant={activeId} aria-autocomplete="list" autoComplete="off"
                id={p.id} name={p.name} placeholder={p.placeholder} disabled={p.disabled} autoFocus={p.autoFocus}
                invalid={p.invalid} fieldSize={p.fieldSize} value={c.text} trailing={p.trailing} data-testid={p.testIds?.input}
                onFocus={p.openOnFocus ? c.show : undefined} onChange={(e) => c.onInputChange(e.target.value)} onKeyDown={c.onKeyDown} onBlur={c.close}
            />
            <ComboboxLiveRegion text={c.open ? (c.status?.text ?? '') : ''} />
            {c.open && (
                <ComboboxPopup
                    popupRef={popupRef} testId={p.testIds?.popup} optionTestId={p.testIds?.option} pos={pos} listboxId={c.listboxId} label={p.label} labelledBy={field?.labelId}
                    items={c.items} status={c.status} activeIndex={c.activeIndex} optionId={c.optionId}
                    isSelected={(o) => !!p.value && p.getKey(o) === p.getKey(p.value)} getKey={p.getKey} portalContainer={container}
                    render={p.renderOption ?? ((o) => <span className="truncate">{p.getLabel(o)}</span>)}
                    onHover={c.setActive} onPick={c.select}
                />
            )}
        </div>
    );
}

/** The shared combobox (ref → the input). See the file header for the contract. */
export const Combobox = forwardRef(ComboboxImpl) as <T>(
    p: ComboboxProps<T> & { ref?: Ref<HTMLInputElement> },
) => JSX.Element;
