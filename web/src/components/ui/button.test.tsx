/**
 * ROK-1646 — the one Button API (spike ROK-1644 §4.1). These lock the
 * contract every migrated call site will lean on: the type default that stops
 * accidental form submits, the five variants, the loading contract and the ref.
 */
import { createRef, useState, type JSX } from 'react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from './button';

describe('Button', () => {
    it('defaults to type="button" so it never submits an enclosing form', () => {
        const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
        render(<form onSubmit={onSubmit}><Button>Save</Button></form>);
        const btn = screen.getByRole('button', { name: 'Save' });
        expect(btn).toHaveAttribute('type', 'button');
        fireEvent.click(btn);
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('keeps an explicit type="submit"', () => {
        render(<Button type="submit">Go</Button>);
        expect(screen.getByRole('button', { name: 'Go' })).toHaveAttribute('type', 'submit');
    });

    it.each([
        ['primary', 'bg-emerald-600'],
        ['secondary', 'bg-panel'],
        ['ghost', 'text-muted'],
        ['destructive', 'bg-red-600'],
        ['destructive-soft', 'bg-danger/10'],
    ] as const)('variant %s paints %s', (variant, cls) => {
        render(<Button variant={variant}>X</Button>);
        expect(screen.getByRole('button', { name: 'X' })).toHaveClass(cls);
    });

    it('defaults to the primary variant at md size with a 44px target', () => {
        render(<Button>X</Button>);
        const btn = screen.getByRole('button', { name: 'X' });
        expect(btn).toHaveClass('bg-emerald-600', 'min-h-[44px]', 'rounded-lg', 'px-4', 'py-2');
    });

    it.each([
        ['lg', ['py-3', 'px-4']],
        ['sm', ['min-h-[44px]', 'lg:min-h-9', 'px-3', 'py-1.5']],
    ] as const)('size %s applies its padding', (size, classes) => {
        render(<Button size={size}>X</Button>);
        expect(screen.getByRole('button', { name: 'X' })).toHaveClass(...classes);
    });

    it('uses a focus-visible ring on the success token', () => {
        render(<Button>X</Button>);
        expect(screen.getByRole('button', { name: 'X' })).toHaveClass('focus-visible:ring-2', 'focus-visible:ring-success/80');
    });

    it('fullWidth stretches the button', () => {
        render(<Button fullWidth>X</Button>);
        expect(screen.getByRole('button', { name: 'X' })).toHaveClass('w-full');
    });
});

describe('Button — states, naming and ref', () => {
    it('disabled uses the single opacity treatment and blocks clicks', () => {
        const onClick = vi.fn();
        render(<Button disabled onClick={onClick}>X</Button>);
        const btn = screen.getByRole('button', { name: 'X' });
        expect(btn).toBeDisabled();
        expect(btn).toHaveClass('disabled:opacity-50', 'disabled:cursor-not-allowed');
        fireEvent.click(btn);
        expect(onClick).not.toHaveBeenCalled();
    });

    it('loading sets aria-busy + aria-disabled (NOT native disabled, so focus stays) and keeps the label width', () => {
        const onClick = vi.fn();
        render(<Button loading onClick={onClick}>Save</Button>);
        const btn = screen.getByRole('button', { name: 'Save' });
        expect(btn).toHaveAttribute('aria-busy', 'true');
        expect(btn).toHaveAttribute('aria-disabled', 'true');
        expect(btn, 'native disabled drops focus from a loading button').not.toHaveAttribute('disabled');
        expect(screen.getByTestId('button-spinner')).toBeInTheDocument();
        expect(screen.getByText('Save', { selector: '[data-button-label]' })).toHaveClass('invisible');
        fireEvent.click(btn);
        expect(onClick).not.toHaveBeenCalled();
    });

    it('loadingLabel becomes the accessible name while loading', () => {
        render(<Button loading loadingLabel="Saving…">Save</Button>);
        expect(screen.getByRole('button', { name: 'Saving…' })).toBeInTheDocument();
    });

    it('is not busy and renders no spinner when not loading', () => {
        render(<Button>Save</Button>);
        expect(screen.getByRole('button', { name: 'Save' })).not.toHaveAttribute('aria-busy');
        expect(screen.queryByTestId('button-spinner')).toBeNull();
    });

    it('iconOnly takes its name from aria-label and gets a 44px width', () => {
        render(<Button iconOnly aria-label="Close" variant="ghost"><svg aria-hidden /></Button>);
        expect(screen.getByRole('button', { name: 'Close' })).toHaveClass('min-w-[44px]');
    });

    it('forwards its ref to the <button>', () => {
        const ref = createRef<HTMLButtonElement>();
        render(<Button ref={ref}>X</Button>);
        expect(ref.current).toBe(screen.getByRole('button', { name: 'X' }));
    });

    it('merges a className override after the variant classes', () => {
        render(<Button className="brand-x">X</Button>);
        expect(screen.getByRole('button', { name: 'X' })).toHaveClass('brand-x', 'bg-emerald-600');
    });
});

describe('Button — loading keeps focus and swallows repeat clicks', () => {
    function Saver({ onSave }: { onSave: () => void }): JSX.Element {
        const [busy, setBusy] = useState(false);
        return <Button loading={busy} onClick={() => { onSave(); setBusy(true); }}>Save</Button>;
    }

    it('a double click while loading calls onClick once and the button keeps focus', async () => {
        const onSave = vi.fn();
        render(<Saver onSave={onSave} />);
        const btn = screen.getByRole('button', { name: 'Save' });
        await userEvent.dblClick(btn);
        expect(onSave, 'the second click of a double click fired while loading').toHaveBeenCalledTimes(1);
        expect(btn).toHaveAttribute('aria-disabled', 'true');
        expect(btn).not.toHaveAttribute('disabled');
        expect(btn).toHaveFocus();
    });

    it('a loading type="submit" button does not submit its form', () => {
        const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
        render(<form onSubmit={onSubmit}><Button type="submit" loading>Save</Button></form>);
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(onSubmit, 'a loading submit button still submitted the form').not.toHaveBeenCalled();
    });
});

/**
 * ROK-1655 ruling 3 — `brandColor` is runtime/brand data (a provider colour,
 * Discord #5865F2), never a theme colour. The inline fill replaces the
 * variant's paint, so the button carries its own label + hover treatment and a
 * `data-brand-fill` hook for the index.css forced-white rule.
 */
describe('Button — brandColor (runtime brand fill)', () => {
    it('paints an inline fill, carries data-brand-fill and keeps a text-foreground label', () => {
        render(<Button brandColor="#5865F2">Discord</Button>);
        const btn = screen.getByRole('button', { name: 'Discord' });
        expect(btn, 'brandColor must set the inline background').toHaveStyle({ backgroundColor: '#5865F2' });
        expect(btn, 'brandColor must emit the data-brand-fill hook for index.css').toHaveAttribute('data-brand-fill');
        expect(btn).toHaveClass('text-foreground', 'hover:brightness-110');
    });

    it('replaces the variant paint so a ghost brand button has no muted label or emerald fill', () => {
        render(<Button variant="ghost" brandColor="#5865F2">Discord</Button>);
        const btn = screen.getByRole('button', { name: 'Discord' });
        expect(btn).toHaveClass('text-foreground');
        expect(btn, 'the variant label colour fights the forced-white label').not.toHaveClass('text-muted');
        expect(btn).not.toHaveClass('bg-emerald-600');
    });

    it("merges into the caller's style without clobbering it", () => {
        render(<Button brandColor="#5865F2" style={{ width: '192px' }}>Discord</Button>);
        const btn = screen.getByRole('button', { name: 'Discord' });
        expect(btn, "the caller's width was dropped by the brand merge").toHaveStyle({ width: '192px' });
        expect(btn).toHaveStyle({ backgroundColor: '#5865F2' });
    });

    it('without brandColor there is no data-brand-fill and no inline background', () => {
        render(<Button>Save</Button>);
        const btn = screen.getByRole('button', { name: 'Save' });
        expect(btn).not.toHaveAttribute('data-brand-fill');
        expect(btn.style.backgroundColor).toBe('');
    });

    it('loading with brandColor still shows the spinner and swallows the click', () => {
        const onClick = vi.fn();
        render(<Button brandColor="#5865F2" loading onClick={onClick}>Discord</Button>);
        const btn = screen.getByRole('button', { name: 'Discord' });
        expect(screen.getByTestId('button-spinner')).toBeInTheDocument();
        expect(btn).toHaveAttribute('aria-busy', 'true');
        fireEvent.click(btn);
        expect(onClick, 'a loading brand button fired onClick').not.toHaveBeenCalled();
    });
});
