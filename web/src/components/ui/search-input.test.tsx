/**
 * ROK-1646 — SearchInput (spike ROK-1644 §4.7): type=search on the shared
 * frame, a decorative leading magnifier, a 44px "Clear search" button, an
 * optional debounced onSearch, and Field context wiring.
 */
import { useState, type JSX } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchInput, type SearchInputProps } from './search-input';
import { Field } from './field';

function Harness(p: Partial<SearchInputProps> & { initial?: string }): JSX.Element {
    const [value, setValue] = useState(p.initial ?? '');
    return <SearchInput label="Search games" {...p} value={value} onChange={setValue} />;
}

afterEach(() => { vi.useRealTimers(); });

describe('SearchInput', () => {
    it('is a named type=search box on the field frame with a leading icon', () => {
        render(<Harness />);
        const box = screen.getByRole('searchbox', { name: 'Search games' });
        expect(box).toHaveAttribute('type', 'search');
        expect(box).toHaveClass('pl-10', 'min-h-[44px]', 'text-base', 'focus-visible:ring-success/80');
        expect(screen.getByTestId('search-input-icon')).toBeInTheDocument();
    });

    it('shows no clear button while empty', () => {
        render(<Harness />);
        expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
    });

    it('the clear button empties the value, calls onClear and refocuses the box', async () => {
        const onClear = vi.fn();
        render(<Harness initial="wow" onClear={onClear} />);
        await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
        const box = screen.getByRole('searchbox', { name: 'Search games' });
        expect(box).toHaveValue('');
        expect(onClear).toHaveBeenCalledTimes(1);
        expect(box).toHaveFocus();
        expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
    });

    it('debounces onSearch and fires once with the settled value', () => {
        vi.useFakeTimers();
        const onSearch = vi.fn();
        render(<Harness onSearch={onSearch} debounceMs={300} />);
        const box = screen.getByRole('searchbox', { name: 'Search games' });
        act(() => { box.focus(); });
        for (const v of ['w', 'wo', 'wow']) {
            act(() => { setNativeValue(box as HTMLInputElement, v); });
            act(() => { vi.advanceTimersByTime(100); });
        }
        expect(onSearch).not.toHaveBeenCalled();
        act(() => { vi.advanceTimersByTime(300); });
        expect(onSearch).toHaveBeenCalledTimes(1);
        expect(onSearch).toHaveBeenCalledWith('wow');
    });

    it('clearing fires onSearch("") immediately, without waiting for the debounce', async () => {
        const onSearch = vi.fn();
        render(<Harness initial="wow" onSearch={onSearch} debounceMs={5000} />);
        await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
        expect(onSearch).toHaveBeenCalledWith('');
    });

    it('takes its name and error from a surrounding Field', () => {
        render(<Field label="Find a player" error="Too short."><SearchInput value="a" onChange={() => undefined} /></Field>);
        const box = screen.getByRole('searchbox', { name: 'Find a player' });
        expect(box).toHaveAttribute('aria-invalid', 'true');
        expect(box).toHaveAccessibleDescription('Too short.');
    });
});

/** Fire a React change event the way typing does (fake timers make userEvent.type hang). */
function setNativeValue(el: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
}
