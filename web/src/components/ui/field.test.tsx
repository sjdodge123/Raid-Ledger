/**
 * ROK-1646 — Field (spike ROK-1644 §4.2). Field owns the label, hint, error and
 * required marker, and hands `id` / `aria-describedby` / `aria-invalid` /
 * `aria-required` to its control through context — so a wrapped child still
 * gets them (the reason this is context, not cloneElement).
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Field } from './field';
import { useFieldControlProps } from './field-context';

/** Minimal control that consumes the context the way Input/Select will. */
function Probe(props: { id?: string; 'aria-describedby'?: string }) {
    const a11y = useFieldControlProps(props);
    return <input {...a11y} />;
}

describe('Field', () => {
    it('labels its control: <label htmlFor> matches the generated id', () => {
        render(<Field label="Event name"><Probe /></Field>);
        const input = screen.getByRole('textbox', { name: 'Event name' });
        expect(input.id).not.toBe('');
        expect(screen.getByText('Event name').closest('label')).toHaveAttribute('for', input.id);
    });

    it('clicking the label focuses the control', () => {
        render(<Field label="Event name"><Probe /></Field>);
        fireEvent.click(screen.getByText('Event name'));
        // jsdom does not move focus on label click; assert the association
        // that makes the browser do so instead.
        const input = screen.getByRole('textbox', { name: 'Event name' });
        expect((screen.getByText('Event name').closest('label') as HTMLLabelElement).control).toBe(input);
    });

    it('reaches a control nested inside wrapper markup', () => {
        render(<Field label="Name"><div><span><Probe /></span></div></Field>);
        expect(screen.getByRole('textbox', { name: 'Name' })).toBeInTheDocument();
    });

    it('uses an explicit id when given', () => {
        render(<Field label="Name" id="event-name"><Probe /></Field>);
        expect(screen.getByRole('textbox', { name: 'Name' })).toHaveAttribute('id', 'event-name');
    });

});

describe('Field — hint, error, required', () => {
    it('links the hint through aria-describedby and is not invalid', () => {
        render(<Field label="Name" hint="Shown on the event card"><Probe /></Field>);
        const input = screen.getByRole('textbox', { name: 'Name' });
        expect(input).toHaveAccessibleDescription('Shown on the event card');
        expect(input).not.toHaveAttribute('aria-invalid');
    });

    it('renders the error inline as role="alert" text-danger, sets aria-invalid and links it', () => {
        render(<Field label="Name" hint="Hint" error="Name is required"><Probe /></Field>);
        const input = screen.getByRole('textbox', { name: 'Name' });
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('Name is required');
        expect(alert).toHaveClass('text-danger');
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(alert.id);
        expect(input).toHaveAccessibleDescription('Hint Name is required');
    });

    it('required shows an aria-hidden danger asterisk and sets aria-required', () => {
        render(<Field label="Name" required><Probe /></Field>);
        const input = screen.getByRole('textbox', { name: 'Name' });
        expect(input).toHaveAttribute('aria-required', 'true');
        const star = screen.getByText('*');
        expect(star).toHaveAttribute('aria-hidden', 'true');
        expect(star).toHaveClass('text-danger');
    });

});

describe('Field — naming edge cases', () => {
    it('hideLabel keeps the accessible name but makes the label sr-only', () => {
        render(<Field label="Search" hideLabel><Probe /></Field>);
        expect(screen.getByRole('textbox', { name: 'Search' })).toBeInTheDocument();
        expect(screen.getByText('Search').closest('label')).toHaveClass('sr-only');
    });

    it('keeps a control-supplied aria-describedby alongside the Field ones', () => {
        render(<Field label="Name" hint="Hint"><Probe aria-describedby="extra" /></Field>);
        const ids = screen.getByRole('textbox', { name: 'Name' }).getAttribute('aria-describedby')?.split(' ');
        expect(ids).toContain('extra');
        expect(ids).toHaveLength(2);
    });

    it('outside a Field the hook passes the control props through untouched', () => {
        render(<Probe id="solo" />);
        const input = screen.getByRole('textbox');
        expect(input).toHaveAttribute('id', 'solo');
        expect(input).not.toHaveAttribute('aria-invalid');
        expect(input).not.toHaveAttribute('aria-describedby');
    });
});
