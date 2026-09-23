/**
 * ROK-1646 — Textarea (spike ROK-1644 §4.4): the shared field frame, resize,
 * the live character counter, forwarded ref and Field context wiring.
 */
import { createRef, useState, type JSX } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Textarea } from './textarea';
import { Field } from './field';

describe('Textarea — frame', () => {
    it('renders on the token frame, resizable vertically by default', () => {
        render(<Textarea aria-label="Notes" />);
        expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveClass(
            'text-base', 'lg:text-sm', 'bg-panel', 'border-edge', 'rounded-lg',
            'focus-visible:ring-success/80', 'resize-y',
        );
    });

    it('resize="none" locks the size', () => {
        render(<Textarea aria-label="Notes" resize="none" />);
        const box = screen.getByRole('textbox', { name: 'Notes' });
        expect(box).toHaveClass('resize-none');
        expect(box).not.toHaveClass('resize-y');
    });

    it('invalid sets aria-invalid and forwards the ref', () => {
        const ref = createRef<HTMLTextAreaElement>();
        render(<Textarea aria-label="Notes" invalid ref={ref} rows={5} />);
        const box = screen.getByRole('textbox', { name: 'Notes' });
        expect(box).toHaveAttribute('aria-invalid', 'true');
        expect(box).toHaveAttribute('rows', '5');
        expect(ref.current).toBe(box);
    });
});

describe('Textarea — counter', () => {
    it('shows no counter without showCount', () => {
        render(<Textarea aria-label="Notes" maxLength={100} />);
        expect(screen.queryByTestId('textarea-count')).not.toBeInTheDocument();
    });

    it('shows no counter with showCount but no maxLength', () => {
        render(<Textarea aria-label="Notes" showCount />);
        expect(screen.queryByTestId('textarea-count')).not.toBeInTheDocument();
    });

    it('counts an uncontrolled textarea as the user types', async () => {
        render(<Textarea aria-label="Notes" showCount maxLength={20} defaultValue="ab" />);
        const count = screen.getByTestId('textarea-count');
        expect(count).toHaveTextContent('2/20');
        expect(count, 'the always-visible counter must not announce every keystroke').not.toHaveAttribute('aria-live');
        expect(count).toHaveClass('text-xs', 'text-dim');
        await userEvent.type(screen.getByRole('textbox', { name: 'Notes' }), 'cde');
        expect(count).toHaveTextContent('5/20');
    });

    it('counts a controlled textarea from its value', async () => {
        function Controlled(): JSX.Element {
            const [v, setV] = useState('hello');
            return <Textarea aria-label="Notes" showCount maxLength={50} value={v} onChange={(e) => setV(e.target.value)} />;
        }
        render(<Controlled />);
        expect(screen.getByTestId('textarea-count')).toHaveTextContent('5/50');
        await userEvent.type(screen.getByRole('textbox', { name: 'Notes' }), '!');
        expect(screen.getByTestId('textarea-count')).toHaveTextContent('6/50');
    });

    it('inside a Field the counter joins the hint in the description', () => {
        render(<Field label="Reason" hint="Optional."><Textarea showCount maxLength={10} defaultValue="abc" /></Field>);
        const box = screen.getByRole('textbox', { name: 'Reason' });
        expect(box).toHaveAccessibleDescription('3/10 Optional.');
    });
});

describe('Textarea — near-limit announcement and size', () => {
    it('announces only near the limit; the visible count always renders', async () => {
        render(<Textarea aria-label="Notes" showCount maxLength={100} defaultValue={'a'.repeat(80)} />);
        const live = screen.getByTestId('textarea-count-live');
        expect(live).toHaveAttribute('aria-live', 'polite');
        expect(live, 'announced while far from the limit').toHaveTextContent(/^$/);
        expect(screen.getByTestId('textarea-count')).toHaveTextContent('80/100');
        await userEvent.type(screen.getByRole('textbox', { name: 'Notes' }), 'b'.repeat(12));
        expect(live).toHaveTextContent('8 characters left');
    });

    it('fieldSize swaps the padding like Input', () => {
        render(<Textarea aria-label="Notes" fieldSize="sm" />);
        expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveClass('lg:py-1', 'lg:px-2');
    });
});
