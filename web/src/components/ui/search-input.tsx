/**
 * SearchInput — the shared search box (ROK-1646, spike ROK-1644 §4.7).
 *
 * Built on `Input`, so it inherits the field frame, the `success` focus ring,
 * 16px text below `lg` and the `Field` context wiring (`id`, `aria-*`).
 * - `type="search"` (role `searchbox`); the browser's own cancel glyph is
 *   hidden so there is exactly one clear affordance.
 * - A decorative leading magnifier and, while there is text, a 44px
 *   `Button ghost iconOnly` named "Clear search" that empties the box,
 *   refocuses it and fires `onSearch('')` at once.
 * - `onChange` hands back the string. `onSearch` is the optional debounced
 *   callback (`debounceMs`, default 300) — it never fires on mount.
 * - `label` becomes `aria-label`; inside a `Field` omit it.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { Input, type InputProps } from './input';
import { Button } from './button';

export interface SearchInputProps extends Omit<InputProps, 'type' | 'value' | 'onChange' | 'leading' | 'trailing'> {
    value: string;
    onChange: (value: string) => void;
    /** Accessible name (`aria-label`). Omit inside a `Field`. */
    label?: string;
    /** Debounced search callback. */
    onSearch?: (query: string) => void;
    debounceMs?: number;
    /** Called after the clear button empties the box. */
    onClear?: () => void;
}

const HIDE_NATIVE_CANCEL = '[&::-webkit-search-cancel-button]:appearance-none';

/** Fire `onSearch` once the value has been still for `ms`; skip the mount value. */
function useDebouncedSearch(value: string, ms: number, onSearch?: (q: string) => void) {
    const latest = useRef(onSearch);
    const lastSent = useRef(value);
    useEffect(() => { latest.current = onSearch; });
    useEffect(() => {
        if (!latest.current || value === lastSent.current) return;
        const t = setTimeout(() => { lastSent.current = value; latest.current?.(value); }, ms);
        return () => clearTimeout(t);
    }, [value, ms]);
    return (now: string) => { lastSent.current = now; latest.current?.(now); };
}

/** The shared search box. See the file header for the contract. */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(props, ref) {
    const { value, onChange, label, onSearch, debounceMs = 300, onClear, className, ...rest } = props;
    const inner = useRef<HTMLInputElement>(null);
    useImperativeHandle(ref, () => inner.current as HTMLInputElement);
    const searchNow = useDebouncedSearch(value, debounceMs, onSearch);
    const clear = (): void => {
        onChange('');
        searchNow('');
        onClear?.();
        inner.current?.focus();
    };
    const clearButton = value !== '' && !rest.disabled ? (
        <Button iconOnly aria-label="Clear search" variant="ghost" onClick={clear}>
            <XMarkIcon className="w-5 h-5" aria-hidden="true" />
        </Button>
    ) : undefined;
    return (
        <Input
            ref={inner} {...rest} type="search" aria-label={rest['aria-label'] ?? label} value={value}
            onChange={(e) => onChange(e.target.value)}
            className={[HIDE_NATIVE_CANCEL, className ?? ''].join(' ').trim()}
            leading={<MagnifyingGlassIcon data-testid="search-input-icon" className="w-5 h-5" aria-hidden="true" />}
            trailing={clearButton}
        />
    );
});
