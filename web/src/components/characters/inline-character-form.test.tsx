/**
 * InlineCharacterForm (ROK-1648 L8): the signup-modal inline create form runs on
 * the shared Field / Input / Select / Button primitives. The name-required error
 * is a Field error on the name input; a failed create is a separate form alert.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InlineCharacterForm } from './inline-character-form';
import { useCreateCharacter } from '../../hooks/use-character-mutations';

vi.mock('../../hooks/use-character-mutations', () => ({
    useCreateCharacter: vi.fn(),
}));

// No plugins active: the WoW import slot renders nothing.
vi.mock('../../plugins', () => ({ PluginSlot: () => null }));

type MutateOpts = { onSuccess?: (d: unknown) => void; onError?: (e: Error) => void };
const mutate = vi.fn();

function mockCreate(isPending = false): void {
    vi.mocked(useCreateCharacter).mockReturnValue(
        { mutate, isPending } as unknown as ReturnType<typeof useCreateCharacter>,
    );
}

function nameInput(): HTMLElement {
    return screen.getByRole('textbox', { name: 'Character name' });
}

function createButton(): HTMLElement {
    return screen.getByRole('button', { name: /create character|creating/i });
}

beforeEach(() => {
    mutate.mockReset();
    mockCreate();
});

describe('InlineCharacterForm — fields', () => {
    it('keeps the accessible names Class / Spec / Role / Realm / Character name', () => {
        render(<InlineCharacterForm gameId={1} />);
        for (const name of ['Character name', 'Class', 'Spec', 'Realm']) {
            expect(screen.getByRole('textbox', { name })).toBeInTheDocument();
        }
        expect(screen.getByRole('combobox', { name: 'Role' })).toBeInTheDocument();
    });

    it('hides the role fields for a game without roles', () => {
        render(<InlineCharacterForm gameId={1} hasRoles={false} />);
        expect(screen.queryByRole('textbox', { name: 'Class' })).toBeNull();
        expect(nameInput()).toBeInTheDocument();
    });
});

describe('InlineCharacterForm — validation', () => {
    it('an empty-name submit marks the name invalid with a Field error and skips the mutation', () => {
        render(<InlineCharacterForm gameId={1} />);
        fireEvent.click(createButton());
        const input = nameInput();
        expect(input.getAttribute('aria-invalid'), 'the name input should be aria-invalid').toBe('true');
        const describedBy = input.getAttribute('aria-describedby') ?? '';
        const errorEl = describedBy ? document.getElementById(describedBy.split(' ').pop()!) : null;
        expect(errorEl, 'the name error should be linked via aria-describedby').not.toBeNull();
        expect(errorEl!.textContent).toBe('Character name is required');
        expect(mutate).not.toHaveBeenCalled();
    });

    it('a valid submit sends the trimmed payload', () => {
        render(<InlineCharacterForm gameId={7} />);
        fireEvent.change(nameInput(), { target: { value: '  Thrall  ' } });
        fireEvent.change(screen.getByRole('combobox', { name: 'Role' }), { target: { value: 'tank' } });
        fireEvent.click(createButton());
        expect(mutate).toHaveBeenCalledTimes(1);
        expect(mutate.mock.calls[0][0]).toMatchObject({ gameId: 7, name: 'Thrall', role: 'tank', isMain: true });
        expect(nameInput().getAttribute('aria-invalid')).not.toBe('true');
    });
});

describe('InlineCharacterForm — mutation error', () => {
    it('renders a failed create as a role=alert form message, not a name error', () => {
        mutate.mockImplementation((_dto: unknown, opts: MutateOpts) => opts.onError?.(new Error('Name already taken')));
        render(<InlineCharacterForm gameId={1} />);
        fireEvent.change(nameInput(), { target: { value: 'Thrall' } });
        fireEvent.click(createButton());
        const alert = screen.queryByRole('alert');
        expect(alert, 'the mutation error should render as role=alert').not.toBeNull();
        expect(alert!.textContent).toBe('Name already taken');
        expect(alert!.className, 'the alert uses the danger token').toContain('text-danger');
        expect(nameInput().getAttribute('aria-invalid'), 'a server error is not a name error').not.toBe('true');
    });
});

describe('InlineCharacterForm — buttons', () => {
    it('Create is aria-busy while pending and a click does not submit', () => {
        mockCreate(true);
        render(<InlineCharacterForm gameId={1} />);
        fireEvent.change(nameInput(), { target: { value: 'Thrall' } });
        const btn = createButton();
        expect(btn.getAttribute('aria-busy'), 'Create should be aria-busy while pending').toBe('true');
        expect(btn.getAttribute('aria-disabled')).toBe('true');
        fireEvent.click(btn);
        expect(mutate).not.toHaveBeenCalled();
    });

    it('Cancel and Create are shared Buttons; Cancel calls onCancel', () => {
        const onCancel = vi.fn();
        render(<InlineCharacterForm gameId={1} onCancel={onCancel} />);
        const cancel = screen.getByRole('button', { name: 'Cancel' });
        expect(cancel.querySelector('[data-button-label]'), 'Cancel should be a Button').not.toBeNull();
        expect(createButton().querySelector('[data-button-label]'), 'Create should be a Button').not.toBeNull();
        expect(createButton().getAttribute('type')).toBe('submit');
        fireEvent.click(cancel);
        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});
