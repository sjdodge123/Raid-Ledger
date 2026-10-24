/**
 * Shared toggle filter chip (design-system.md §4.3, promoted by ROK-1943).
 *
 * The §4.3 geometry used to live only as copied class strings in the
 * `/dev/design-system` gallery. Its first product adopter (the Valheim Map pin
 * filter) promoted it here, so every toggle chip shares one class list. The ON
 * label is `text-amber-400`, not `text-amber-300`: amber-300 has no readable
 * light-family repaint (§6.9). A toggle, never navigation (`NavChip`) and never
 * a page's whole filter set (§4.1 funnel).
 */
import type { ComponentType, JSX, SVGProps } from 'react';
import { filterChipClass } from './filter-chip-classes';

export interface FilterChipProps {
    /** Visible label; also the button's accessible name. */
    label: string;
    /** Whether the filter is on (`aria-pressed`). */
    pressed: boolean;
    /** Called with the NEXT pressed state on click. */
    onPressedChange: (pressed: boolean) => void;
    /** Optional leading icon (rendered `aria-hidden`). */
    icon?: ComponentType<SVGProps<SVGSVGElement>>;
    disabled?: boolean;
    className?: string;
    testId?: string;
}

/** A `<button type="button" aria-pressed>` toggle chip with the §4.3 geometry. */
export function FilterChip({ label, pressed, onPressedChange, icon: Icon, disabled, className, testId }: FilterChipProps): JSX.Element {
    return (
        <button
            type="button"
            aria-pressed={pressed}
            disabled={disabled}
            data-testid={testId}
            onClick={() => onPressedChange(!pressed)}
            className={className ? `${filterChipClass(pressed)} ${className}` : filterChipClass(pressed)}
        >
            {Icon && <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />}
            {label}
        </button>
    );
}
