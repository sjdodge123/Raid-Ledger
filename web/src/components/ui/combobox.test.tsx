/**
 * ROK-1646 — Combobox (spike ROK-1644 §4.7, operator ruling: in-house, no
 * headless library). The WAI-ARIA 1.2 combobox pattern: role/state wiring,
 * the keyboard contract, mouse selection, async states and the portalled
 * listbox (still reachable by role, and safe inside a Modal).
 */
import { useState, type JSX } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Combobox, type ComboboxProps } from './combobox';
import { Field } from './field';
import { Modal } from './modal';

interface Game { id: string; name: string }
const GAMES: Game[] = [{ id: '1', name: 'Diablo IV' }, { id: '2', name: 'Destiny 2' }, { id: '3', name: 'Dota 2' }];

type HarnessProps = Partial<ComboboxProps<Game>> & { spy?: (g: Game | null) => void; initial?: Game | null };

function Harness({ spy, initial = null, ...p }: HarnessProps): JSX.Element {
    const [value, setValue] = useState<Game | null>(initial);
    return (
        <Combobox<Game> label="Game" options={GAMES} getKey={(g) => g.id} getLabel={(g) => g.name}
            value={value} onChange={(g) => { setValue(g); spy?.(g); }} {...p} />
    );
}

const box = (): HTMLElement => screen.getByRole('combobox', { name: 'Game' });
const activeId = (): string | null => box().getAttribute('aria-activedescendant');
const optionId = (name: string): string => screen.getByRole('option', { name }).id;

beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });

describe('Combobox — ARIA wiring', () => {
    it('is a collapsed, named combobox that controls a listbox', () => {
        render(<Harness />);
        expect(box()).toHaveAttribute('aria-expanded', 'false');
        expect(box()).toHaveAttribute('aria-autocomplete', 'list');
        expect(box(), 'aria-controls must not point at a listbox that is not rendered').not.toHaveAttribute('aria-controls');
        expect(box()).not.toHaveAttribute('aria-activedescendant');
        expect(box()).toHaveClass('text-base', 'focus-visible:ring-success/80');
    });

    it('portals the listbox to <body>, still found by role, linked by aria-controls', async () => {
        const { container } = render(<Harness />);
        await userEvent.type(box(), '{ArrowDown}');
        const listbox = screen.getByRole('listbox');
        expect(container.contains(listbox)).toBe(false);
        expect(box()).toHaveAttribute('aria-expanded', 'true');
        expect(box()).toHaveAttribute('aria-controls', listbox.id);
        expect(within(listbox).getAllByRole('option')).toHaveLength(3);
        expect(screen.getByRole('option', { name: 'Diablo IV' })).toHaveClass('min-h-[44px]');
    });

    it('marks the current value aria-selected', async () => {
        render(<Harness initial={GAMES[2]} />);
        await userEvent.type(box(), '{ArrowDown}');
        expect(screen.getByRole('option', { name: 'Dota 2' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('option', { name: 'Diablo IV' })).toHaveAttribute('aria-selected', 'false');
    });

    it('takes its name from a surrounding Field', () => {
        render(<Field label="Pick a game"><Combobox<Game> options={GAMES} getKey={(g) => g.id}
            getLabel={(g) => g.name} value={null} onChange={() => undefined} /></Field>);
        expect(screen.getByRole('combobox', { name: 'Pick a game' })).toBeInTheDocument();
    });

    it('names the portalled listbox after the Field label', async () => {
        render(<Field label="Pick a game"><Combobox<Game> options={GAMES} getKey={(g) => g.id}
            getLabel={(g) => g.name} value={null} onChange={() => undefined} /></Field>);
        await userEvent.type(screen.getByRole('combobox', { name: 'Pick a game' }), '{ArrowDown}');
        expect(screen.getByRole('listbox', { name: 'Pick a game' })).toBeInTheDocument();
    });
});

describe('Combobox — keyboard', () => {
    it('ArrowDown opens on the first option and moves down; aria-activedescendant follows', async () => {
        render(<Harness />);
        await userEvent.type(box(), '{ArrowDown}');
        expect(activeId()).toBe(optionId('Diablo IV'));
        await userEvent.keyboard('{ArrowDown}');
        expect(activeId()).toBe(optionId('Destiny 2'));
        expect(Element.prototype.scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' });
    });

    it('ArrowUp moves up, and wraps from the first option to the last', async () => {
        render(<Harness />);
        await userEvent.type(box(), '{ArrowDown}{ArrowDown}{ArrowUp}');
        expect(activeId()).toBe(optionId('Diablo IV'));
        await userEvent.keyboard('{ArrowUp}');
        expect(activeId()).toBe(optionId('Dota 2'));
    });

    it('End jumps to the last option and Home to the first', async () => {
        render(<Harness />);
        await userEvent.type(box(), '{ArrowDown}{End}');
        expect(activeId()).toBe(optionId('Dota 2'));
        await userEvent.keyboard('{Home}');
        expect(activeId()).toBe(optionId('Diablo IV'));
    });

});

describe('Combobox — keyboard: commit and dismiss', () => {
    it('Enter selects the active option, calls onChange, fills the input and closes', async () => {
        const spy = vi.fn();
        render(<Harness spy={spy} />);
        await userEvent.type(box(), '{ArrowDown}{ArrowDown}{Enter}');
        expect(spy).toHaveBeenCalledWith(GAMES[1]);
        expect(box()).toHaveValue('Destiny 2');
        expect(box()).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('Escape closes; a second Escape clears the text and the value', async () => {
        const spy = vi.fn();
        render(<Harness spy={spy} initial={GAMES[0]} inputValue={undefined} />);
        await userEvent.clear(box());
        await userEvent.type(box(), 'Dia{ArrowDown}{Escape}');
        expect(box()).toHaveAttribute('aria-expanded', 'false');
        expect(box()).toHaveValue('Dia');
        await userEvent.keyboard('{Escape}');
        expect(box()).toHaveValue('');
        expect(spy).toHaveBeenLastCalledWith(null);
    });

    it('Tab commits the active option and closes', async () => {
        const spy = vi.fn();
        render(<><Harness spy={spy} /><button type="button">next</button></>);
        await userEvent.type(box(), '{ArrowDown}{End}');
        await userEvent.tab();
        expect(spy).toHaveBeenCalledWith(GAMES[2]);
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('typing opens the popup and reports the text through onInputChange', async () => {
        const onInputChange = vi.fn();
        render(<Harness onInputChange={onInputChange} />);
        await userEvent.type(box(), 'd');
        expect(onInputChange).toHaveBeenLastCalledWith('d');
        expect(box()).toHaveAttribute('aria-expanded', 'true');
    });

    it('Escape inside a Modal closes the popup, not the modal', async () => {
        const onClose = vi.fn();
        render(<Modal isOpen onClose={onClose} title="Add character"><Harness /></Modal>);
        await userEvent.type(box(), '{ArrowDown}{Escape}');
        expect(box()).toHaveAttribute('aria-expanded', 'false');
        expect(onClose).not.toHaveBeenCalled();
    });
});

describe('Combobox — mouse, outside click, async', () => {
    it('clicking an option selects it', async () => {
        const spy = vi.fn();
        render(<Harness spy={spy} />);
        await userEvent.type(box(), '{ArrowDown}');
        await userEvent.click(screen.getByRole('option', { name: 'Dota 2' }));
        expect(spy).toHaveBeenCalledWith(GAMES[2]);
        expect(box()).toHaveValue('Dota 2');
    });

    it('an outside click closes the popup', async () => {
        render(<><Harness /><p>elsewhere</p></>);
        await userEvent.type(box(), '{ArrowDown}');
        await userEvent.click(screen.getByText('elsewhere'));
        expect(box()).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('loading shows a status row instead of options', async () => {
        render(<Harness loading loadingText="Searching…" />);
        await userEvent.type(box(), 'd');
        expect(screen.getByRole('status')).toHaveTextContent('Searching…');
        expect(screen.queryAllByRole('option')).toHaveLength(0);
    });

    it('no options shows emptyText; errorText wins over it', async () => {
        const { rerender } = render(<Harness options={[]} emptyText="No games found" />);
        await userEvent.type(box(), 'zzz');
        expect(screen.getByRole('status')).toHaveTextContent('No games found');
        rerender(<Harness options={[]} emptyText="No games found" errorText="Search is unavailable" />);
        expect(screen.getByRole('status')).toHaveTextContent('Search is unavailable');
    });

    it('renderOption customises the row but keeps the option semantics', async () => {
        render(<Harness renderOption={(g, s) => <span data-testid={`row-${g.id}`}>{g.name}{s.active ? ' *' : ''}</span>} />);
        await userEvent.type(box(), '{ArrowDown}');
        expect(screen.getByTestId('row-1')).toHaveTextContent('Diablo IV *');
        expect(screen.getByTestId('row-1').closest('[role="option"]')).toHaveAttribute('aria-selected', 'false');
    });
});

describe('Combobox — IME, external reset, portal target, live region', () => {
    it('ignores Enter and arrows while an IME composition is in progress', async () => {
        const spy = vi.fn();
        render(<Harness spy={spy} />);
        await userEvent.type(box(), '{ArrowDown}');
        const first = activeId();
        fireEvent.keyDown(box(), { key: 'ArrowDown', isComposing: true });
        expect(activeId(), 'a composing ArrowDown moved the active option').toBe(first);
        fireEvent.keyDown(box(), { key: 'Enter', keyCode: 229 });
        expect(spy, 'Enter confirming an IME candidate also selected an option').not.toHaveBeenCalled();
        expect(box()).toHaveAttribute('aria-expanded', 'true');
    });

    it('an external reset of value to null clears the stale label', () => {
        const props = { label: 'Game', options: GAMES, getKey: (g: Game) => g.id, getLabel: (g: Game) => g.name, onChange: () => undefined };
        const { rerender } = render(<Combobox<Game> {...props} value={GAMES[1]} />);
        expect(box()).toHaveValue('Destiny 2');
        rerender(<Combobox<Game> {...props} value={null} />);
        expect(box(), 'the input kept the label of a value that was reset to null').toHaveValue('');
    });

    it('inside a Modal the listbox portals into the dialog (aria-modal hides everything else)', async () => {
        render(<Modal isOpen onClose={() => undefined} title="Add character"><Harness /></Modal>);
        await userEvent.type(box(), '{ArrowDown}');
        expect(screen.getByRole('listbox').closest('[role="dialog"]'), 'listbox rendered outside the aria-modal dialog').not.toBeNull();
    });

    it('portalContainer overrides the portal target', async () => {
        const target = document.createElement('div');
        document.body.appendChild(target);
        render(<Harness portalContainer={target} />);
        await userEvent.type(box(), '{ArrowDown}');
        expect(target.contains(screen.getByRole('listbox')), 'listbox not rendered into portalContainer').toBe(true);
        target.remove();
    });

    it('keeps ONE persistent role="status" live region, mounted while closed, text updated', async () => {
        render(<Harness loading loadingText="Searching…" />);
        const region = screen.getByRole('status');
        expect(region).toHaveTextContent('');
        await userEvent.type(box(), 'd');
        expect(screen.getAllByRole('status')).toHaveLength(1);
        expect(screen.getByRole('status'), 'the live region was remounted instead of updated').toBe(region);
        expect(region).toHaveTextContent('Searching…');
    });
});

describe('Combobox — trailing, openOnFocus, testIds (ROK-1647)', () => {
    it('renders `trailing` inside the field frame and keeps it interactive', async () => {
        const onTrail = vi.fn();
        const { container } = render(<Harness trailing={<button type="button" onClick={onTrail}>Trail</button>} />);
        const trail = screen.getByRole('button', { name: 'Trail' });
        expect(container.contains(trail), 'trailing must render inside the combobox wrapper').toBe(true);
        expect(box().parentElement, 'trailing shares the input\'s adornment frame').toContainElement(trail);
        await userEvent.click(trail);
        expect(onTrail).toHaveBeenCalledOnce();
    });

    it('openOnFocus opens the listbox on focus without an active option', async () => {
        render(<Harness openOnFocus />);
        await userEvent.click(box());
        expect(box(), 'focus alone must open the popup').toHaveAttribute('aria-expanded', 'true');
        expect(screen.getAllByRole('option')).toHaveLength(3);
        expect(box(), 'no option is highlighted until the user moves').not.toHaveAttribute('aria-activedescendant');
    });

    it('stays closed on focus without openOnFocus', async () => {
        render(<Harness />);
        await userEvent.click(box());
        expect(box()).toHaveAttribute('aria-expanded', 'false');
    });

    it('testIds land on the input, the popup and every role="option" row', async () => {
        render(<Harness testIds={{ input: 'in', popup: 'pop', option: 'opt' }} />);
        expect(box()).toHaveAttribute('data-testid', 'in');
        await userEvent.type(box(), '{ArrowDown}');
        expect(screen.getByRole('listbox').parentElement).toHaveAttribute('data-testid', 'pop');
        expect(screen.getByRole('option', { name: 'Diablo IV' }), 'the option testid must sit on the option row').toHaveAttribute('data-testid', 'opt');
    });
});
