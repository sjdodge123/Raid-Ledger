/**
 * Combobox props (ROK-1646). Kept apart from `combobox.tsx` so the hook and
 * the popup can import the type without a component-file cycle.
 */
import type { ReactNode } from 'react';
import type { FieldSize } from './form-classes';

export interface ComboboxOptionState {
    /** The keyboard/hover-highlighted option (`aria-activedescendant`). */
    active: boolean;
    /** The option equal to `value` (`aria-selected`). */
    selected: boolean;
}

export interface ComboboxProps<T> {
    options: T[];
    getKey: (option: T) => string;
    /** Text written into the input when the option is picked; also the default row. */
    getLabel: (option: T) => string;
    value: T | null;
    onChange: (option: T | null) => void;
    /** Accessible name (`aria-label`). Omit inside a `Field`. */
    label?: string;
    /** Controlled input text. Omit to let the combobox own it. */
    inputValue?: string;
    onInputChange?: (text: string) => void;
    renderOption?: (option: T, state: ComboboxOptionState) => ReactNode;
    /** Async search in flight: shows `loadingText` and hides stale options. */
    loading?: boolean;
    loadingText?: string;
    /** Shown when there are no options (default "No results"). */
    emptyText?: string;
    /** Shown (in `text-danger`) instead of options when the search failed. */
    errorText?: string;
    id?: string;
    name?: string;
    placeholder?: string;
    disabled?: boolean;
    invalid?: boolean;
    autoFocus?: boolean;
    fieldSize?: FieldSize;
    /**
     * Where the listbox portals. Default: the surrounding `[role="dialog"]`
     * (Modal / BottomSheet — `aria-modal` hides anything outside it), else `<body>`.
     */
    portalContainer?: HTMLElement | null;
    /** Classes for the wrapper (default `w-full`). */
    className?: string;
    /** Interactive slot inside the input's right edge (e.g. a 44px clear button). */
    trailing?: ReactNode;
    /** Open the listbox when the input gains focus (e.g. to offer suggestions before typing). */
    openOnFocus?: boolean;
    /** `data-testid` hooks for the input and the popup (smoke specs). */
    testIds?: { input?: string; popup?: string };
}

export interface ComboboxStatus {
    text: string;
    tone: 'muted' | 'danger';
}
