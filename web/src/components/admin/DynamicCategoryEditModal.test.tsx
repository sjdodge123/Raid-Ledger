import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DiscoveryCategorySuggestionDto } from '@raid-ledger/contract';
import { DynamicCategoryEditModal } from './DynamicCategoryEditModal';

const SUGGESTION: DiscoveryCategorySuggestionDto = {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Original Name',
    description: 'Original description',
    categoryType: 'trend',
    themeVector: [0, 0, 0, 0, 0, 0, 0],
    filterCriteria: {},
    candidateGameIds: [],
    status: 'pending',
    populationStrategy: 'vector',
    sortOrder: 0,
    expiresAt: null,
    generatedAt: '2026-04-22T00:00:00.000Z',
    reviewedBy: null,
    reviewedAt: null,
    createdAt: '2026-04-22T00:00:00.000Z',
};

function renderModal(onSave = vi.fn(), isSaving = false) {
    render(
        <DynamicCategoryEditModal
            isOpen
            suggestion={SUGGESTION}
            onClose={() => {}}
            onSave={onSave}
            isSaving={isSaving}
        />,
    );
    return onSave;
}

describe('DynamicCategoryEditModal', () => {
    it('prefills inputs from the suggestion', () => {
        renderModal();
        expect(screen.getByLabelText(/name/i)).toHaveValue('Original Name');
        expect(screen.getByLabelText(/description/i)).toHaveValue(
            'Original description',
        );
    });

    it('blocks save and shows validation errors when name is empty', async () => {
        const onSave = vi.fn();
        renderModal(onSave);
        fireEvent.change(screen.getByLabelText(/name/i), {
            target: { value: '' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
        expect(onSave).not.toHaveBeenCalled();
    });

    it('calls onSave with patched fields when valid', async () => {
        const onSave = vi.fn();
        renderModal(onSave);
        fireEvent.change(screen.getByLabelText(/name/i), {
            target: { value: 'Renamed' },
        });
        fireEvent.change(screen.getByLabelText(/description/i), {
            target: { value: 'New desc' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => {
            expect(onSave).toHaveBeenCalledWith(SUGGESTION.id, {
                name: 'Renamed',
                description: 'New desc',
            });
        });
    });

    it('returns null when no suggestion is supplied', () => {
        const { container } = render(
            <DynamicCategoryEditModal
                isOpen
                suggestion={null}
                onClose={() => {}}
                onSave={() => {}}
            />,
        );
        expect(container).toBeEmptyDOMElement();
    });
});

/*
 * ROK-1653 G5b (AC2b): the fields are shared `Field`s, so a failed save marks
 * the control invalid and ties it to a role=alert message; Save is a loading
 * `Button` (ruling 7: aria-busy + aria-disabled + a swallowed click, never
 * native `disabled`).
 */
describe('DynamicCategoryEditModal — Field + Button (ROK-1653)', () => {
    it('an empty name on Save marks Name aria-invalid, described by a role=alert "Name is required"', async () => {
        renderModal();
        // Exact label, mirroring the smoke's getByLabel(/^Name$/i): no asterisk.
        const name = screen.getByLabelText(/^Name$/i);
        fireEvent.change(name, { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        const message = await screen.findByText('Name is required');
        expect(name).toHaveAttribute('aria-invalid', 'true');
        expect(message).toHaveAttribute('role', 'alert');
        expect(message.id).not.toBe('');
        expect(name.getAttribute('aria-describedby')?.split(' ')).toContain(message.id);
        expect(screen.getByLabelText(/^Description$/i)).not.toHaveAttribute('aria-invalid', 'true');
    });

    it('a pending Save is aria-busy + aria-disabled, named "Saving…", and swallows a click (ruling 7)', () => {
        const onSave = renderModal(vi.fn(), true);
        const save = screen.getByRole('button', { name: 'Saving…' });
        expect(save).toHaveAttribute('aria-busy', 'true');
        expect(save).toHaveAttribute('aria-disabled', 'true');
        fireEvent.click(save);
        expect(onSave).not.toHaveBeenCalled();
    });
});

/*
 * ROK-1655 wiring (ROK-1653 G5c): an edited name or description must not
 * vanish on Escape, the backdrop, × or the footer Cancel — the modal asks
 * "Discard your changes?" first. Untouched fields close at once. Cancel and
 * Save sit in the Modal's pinned footer; Save submits the form via `form=`.
 */
const CONFIRM = 'Discard your changes?';
const editDialog = () => screen.getByRole('dialog', { name: 'Edit Category' });
const nameInput = () => screen.getByLabelText(/^Name$/i);

function renderGuarded() {
    const onClose = vi.fn();
    const onSave = vi.fn();
    render(<DynamicCategoryEditModal isOpen suggestion={SUGGESTION} onClose={onClose} onSave={onSave} />);
    return { onClose, onSave };
}

const CLOSE_PATHS: Array<[string, () => void]> = [
    ['Escape', () => { fireEvent.keyDown(document, { key: 'Escape' }); }],
    ['×', () => { fireEvent.click(within(editDialog()).getByRole('button', { name: 'Close modal' })); }],
    ['the backdrop', () => {
        fireEvent.click(editDialog().parentElement!.querySelector('[aria-hidden="true"]') as HTMLElement);
    }],
];

describe('DynamicCategoryEditModal — dirty-close guard (ROK-1655)', () => {
    it('an edited name + Escape asks; Keep editing keeps the edit and does not close', () => {
        const { onClose } = renderGuarded();
        fireEvent.change(nameInput(), { target: { value: 'Renamed' } });
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByText(CONFIRM), 'a dirty Escape must ask to discard').not.toBeNull();
        expect(onClose, 'a dirty Escape must not close').not.toHaveBeenCalled();

        fireEvent.click(screen.getByTestId('discard-changes-keep'));
        expect(screen.queryByText(CONFIRM)).not.toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
        expect(nameInput(), 'Keep must leave the edited name in place').toHaveValue('Renamed');
    });

    it('an edited name + Escape, then Discard, calls onClose', () => {
        const { onClose } = renderGuarded();
        fireEvent.change(nameInput(), { target: { value: 'Renamed' } });
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByTestId('discard-changes-discard'), 'a dirty Escape must offer Discard').not.toBeNull();
        expect(onClose, 'a dirty Escape must not close before Discard').not.toHaveBeenCalled();
        fireEvent.click(screen.getByTestId('discard-changes-discard'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('an edited description + × asks', () => {
        const { onClose } = renderGuarded();
        fireEvent.change(screen.getByLabelText(/^Description$/i), { target: { value: 'New desc' } });
        CLOSE_PATHS[1][1]();
        expect(screen.queryByText(CONFIRM), 'an edited description is dirty too').not.toBeNull();
        expect(onClose).not.toHaveBeenCalled();
    });

    it.each(CLOSE_PATHS)('with no edits, %s closes at once with no confirm', (_path, close) => {
        const { onClose } = renderGuarded();
        close();
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(screen.queryByText(CONFIRM), 'a clean close must not ask').not.toBeInTheDocument();
    });

    it('with an edit, the footer Cancel asks instead of closing', () => {
        const { onClose } = renderGuarded();
        fireEvent.change(nameInput(), { target: { value: 'Renamed' } });
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByText(CONFIRM), 'an explicit Cancel is guarded (ruling 4)').not.toBeNull();
        expect(onClose).not.toHaveBeenCalled();
    });
});

describe('DynamicCategoryEditModal — pinned footer + form submit (ROK-1655)', () => {
    it('Cancel and Save sit in the modal-footer, outside the scrolling body', () => {
        renderGuarded();
        const footer = screen.queryByTestId('modal-footer');
        expect(footer, 'the Modal must render its pinned footer').not.toBeNull();
        expect(footer!, 'Save must be in the pinned footer').toContainElement(screen.getByRole('button', { name: 'Save' }));
        expect(footer!, 'Cancel must be in the pinned footer').toContainElement(screen.getByRole('button', { name: 'Cancel' }));
        const body = footer!.previousElementSibling as HTMLElement;
        expect(body).toContainElement(nameInput());
        expect(body, 'the scroll body must not hold Save').not.toContainElement(screen.getByRole('button', { name: 'Save' }));
    });

    it('pressing Enter in the Name input saves the edit', async () => {
        const user = userEvent.setup();
        const { onSave, onClose } = renderGuarded();
        await user.clear(nameInput());
        await user.type(nameInput(), 'Renamed{Enter}');
        expect(onSave, 'Enter in Name must submit the form').toHaveBeenCalledWith(SUGGESTION.id, {
            name: 'Renamed',
            description: 'Original description',
        });
        expect(screen.queryByText(CONFIRM), 'a save must not ask to discard').not.toBeInTheDocument();
        expect(onClose, 'the parent closes after a save, not the modal').not.toHaveBeenCalled();
    });
});
