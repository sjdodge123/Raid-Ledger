import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { axe } from 'vitest-axe';
import { Modal } from './modal';

describe('Modal — part 1', () => {
    beforeEach(() => {
        document.body.style.overflow = '';
    });
    afterEach(() => {
        document.body.style.overflow = '';
    });

    it('renders nothing when isOpen is false', () => {
        render(
            <Modal isOpen={false} onClose={vi.fn()} title="Test Modal">
                <p>Content</p>
            </Modal>,
        );
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('renders dialog when isOpen is true', () => {
        render(
            <Modal isOpen={true} onClose={vi.fn()} title="Test Modal">
                <p>Content</p>
            </Modal>,
        );
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('renders children inside the dialog', () => {
        render(
            <Modal isOpen={true} onClose={vi.fn()} title="Test Modal">
                <p>Modal body content</p>
            </Modal>,
        );
        expect(screen.getByText('Modal body content')).toBeInTheDocument();
    });

    it('renders the title text', () => {
        render(
            <Modal isOpen={true} onClose={vi.fn()} title="My Dialog Title">
                <p>Content</p>
            </Modal>,
        );
        expect(screen.getByText('My Dialog Title')).toBeInTheDocument();
    });

});

describe('ARIA semantics (ROK-342) — part 1', () => {
    beforeEach(() => {
        document.body.style.overflow = '';
    });
    afterEach(() => {
        document.body.style.overflow = '';
    });
        it('dialog has role="dialog"', () => {
            render(
                <Modal isOpen={true} onClose={vi.fn()} title="ARIA Test">
                    <p>Content</p>
                </Modal>,
            );
            const dialog = screen.getByRole('dialog');
            expect(dialog).toHaveAttribute('role', 'dialog');
        });

        it('dialog has aria-modal="true"', () => {
            render(
                <Modal isOpen={true} onClose={vi.fn()} title="ARIA Test">
                    <p>Content</p>
                </Modal>,
            );
            const dialog = screen.getByRole('dialog');
            expect(dialog).toHaveAttribute('aria-modal', 'true');
        });

        it('dialog has aria-labelledby pointing to title element', () => {
            render(
                <Modal isOpen={true} onClose={vi.fn()} title="Labeled Title">
                    <p>Content</p>
                </Modal>,
            );
            const dialog = screen.getByRole('dialog');
            const labelledById = dialog.getAttribute('aria-labelledby');
            expect(labelledById).toBeTruthy();

            const titleEl = document.getElementById(labelledById!);
            expect(titleEl).toBeInTheDocument();
            expect(titleEl?.textContent).toBe('Labeled Title');
        });

        it('title element is an h2', () => {
            render(
                <Modal isOpen={true} onClose={vi.fn()} title="H2 Title">
                    <p>Content</p>
                </Modal>,
            );
            const dialog = screen.getByRole('dialog');
            const labelledById = dialog.getAttribute('aria-labelledby');
            const titleEl = document.getElementById(labelledById!);
            expect(titleEl?.tagName).toBe('H2');
        });

        it('close button has aria-label="Close modal"', () => {
            render(
                <Modal isOpen={true} onClose={vi.fn()} title="Test">
                    <p>Content</p>
                </Modal>,
            );
            const closeBtn = screen.getByRole('button', { name: 'Close modal' });
            expect(closeBtn).toBeInTheDocument();
        });

});

describe('Modal — part 3', () => {
    beforeEach(() => {
        document.body.style.overflow = '';
    });
    afterEach(() => {
        document.body.style.overflow = '';
    });

    describe('ARIA semantics (ROK-342) — part 2', () => {
        it('backdrop has aria-hidden="true"', () => {
            render(
                <Modal isOpen={true} onClose={vi.fn()} title="Test">
                    <p>Content</p>
                </Modal>,
            );
            const dialog = screen.getByRole('dialog');
            const backdrop = dialog.parentElement?.querySelector('[aria-hidden="true"]');
            expect(backdrop).toBeInTheDocument();
        });

    });

    describe('Escape key closes modal (ROK-342 AC)', () => {
        it('calls onClose when Escape key is pressed', () => {
            const onClose = vi.fn();
            render(
                <Modal isOpen={true} onClose={onClose} title="Escape Test">
                    <p>Content</p>
                </Modal>,
            );
            fireEvent.keyDown(document, { key: 'Escape' });
            expect(onClose).toHaveBeenCalledOnce();
        });

        it('does not call onClose for non-Escape keys', () => {
            const onClose = vi.fn();
            render(
                <Modal isOpen={true} onClose={onClose} title="Escape Test">
                    <p>Content</p>
                </Modal>,
            );
            fireEvent.keyDown(document, { key: 'Enter' });
            fireEvent.keyDown(document, { key: 'Tab' });
            expect(onClose).not.toHaveBeenCalled();
        });

        it('does not register Escape listener when modal is closed', () => {
            const onClose = vi.fn();
            render(
                <Modal isOpen={false} onClose={onClose} title="Closed Modal">
                    <p>Content</p>
                </Modal>,
            );
            fireEvent.keyDown(document, { key: 'Escape' });
            expect(onClose).not.toHaveBeenCalled();
        });
    });

});

describe('Modal — part 4', () => {
    beforeEach(() => {
        document.body.style.overflow = '';
    });
    afterEach(() => {
        document.body.style.overflow = '';
    });

    describe('backdrop click closes modal', () => {
        it('calls onClose when backdrop is clicked', () => {
            const onClose = vi.fn();
            render(
                <Modal isOpen={true} onClose={onClose} title="Backdrop Test">
                    <p>Content</p>
                </Modal>,
            );
            const dialog = screen.getByRole('dialog');
            const backdrop = dialog.parentElement?.querySelector('[aria-hidden="true"]') as HTMLElement;
            expect(backdrop).toBeTruthy();
            fireEvent.click(backdrop);
            expect(onClose).toHaveBeenCalledOnce();
        });

        it('calls onClose when close button is clicked', () => {
            const onClose = vi.fn();
            render(
                <Modal isOpen={true} onClose={onClose} title="Test">
                    <p>Content</p>
                </Modal>,
            );
            const closeBtn = screen.getByRole('button', { name: 'Close modal' });
            fireEvent.click(closeBtn);
            expect(onClose).toHaveBeenCalledOnce();
        });
    });

});

describe('Modal — part 5', () => {
    beforeEach(() => {
        document.body.style.overflow = '';
    });
    afterEach(() => {
        document.body.style.overflow = '';
    });

    describe('body scroll locking', () => {
        it('locks body scroll when modal opens', () => {
            render(
                <Modal isOpen={true} onClose={vi.fn()} title="Scroll Test">
                    <p>Content</p>
                </Modal>,
            );
            expect(document.body.style.overflow).toBe('hidden');
        });

        it('restores body scroll when modal closes', () => {
            const { rerender } = render(
                <Modal isOpen={true} onClose={vi.fn()} title="Scroll Test">
                    <p>Content</p>
                </Modal>,
            );
            expect(document.body.style.overflow).toBe('hidden');

            rerender(
                <Modal isOpen={false} onClose={vi.fn()} title="Scroll Test">
                    <p>Content</p>
                </Modal>,
            );
            expect(document.body.style.overflow).toBe('');
        });

        it('restores body scroll on unmount', () => {
            const { unmount } = render(
                <Modal isOpen={true} onClose={vi.fn()} title="Scroll Test">
                    <p>Content</p>
                </Modal>,
            );
            unmount();
            expect(document.body.style.overflow).toBe('');
        });
    });

});

describe('Modal — part 6', () => {
    beforeEach(() => {
        document.body.style.overflow = '';
    });
    afterEach(() => {
        document.body.style.overflow = '';
    });

    describe('custom props', () => {
        it('applies custom maxWidth class', () => {
            render(
                <Modal isOpen={true} onClose={vi.fn()} title="Test" maxWidth="max-w-2xl">
                    <p>Content</p>
                </Modal>,
            );
            const dialog = screen.getByRole('dialog');
            expect(dialog).toHaveClass('max-w-2xl');
        });

        it('applies default max-w-md when maxWidth is not provided', () => {
            render(
                <Modal isOpen={true} onClose={vi.fn()} title="Test">
                    <p>Content</p>
                </Modal>,
            );
            const dialog = screen.getByRole('dialog');
            expect(dialog).toHaveClass('max-w-md');
        });

        it('applies custom bodyClassName', () => {
            render(
                <Modal isOpen={true} onClose={vi.fn()} title="Test" bodyClassName="custom-body-class">
                    <p>Content</p>
                </Modal>,
            );
            const bodyEl = screen.getByText('Content').closest('.custom-body-class');
            expect(bodyEl).toBeInTheDocument();
        });
    });

    describe('portal rendering', () => {
        it('renders into document.body via portal', () => {
            const wrapper = document.createElement('div');
            wrapper.id = 'app-wrapper';
            document.body.appendChild(wrapper);

            render(
                <Modal isOpen={true} onClose={vi.fn()} title="Portal Test">
                    <p>Portal content</p>
                </Modal>,
                { container: wrapper },
            );

            // The dialog should be in document.body, not just the wrapper
            const dialog = document.querySelector('[role="dialog"]');
            expect(dialog).toBeInTheDocument();

            wrapper.remove();
        });
    });

});

describe('Modal — part 7', () => {
    beforeEach(() => {
        document.body.style.overflow = '';
    });
    afterEach(() => {
        document.body.style.overflow = '';
    });

    describe('accessibility', () => {
        it('has no accessibility violations when open', async () => {
            const { container } = render(
                <Modal isOpen={true} onClose={vi.fn()} title="Accessible Modal">
                    <p>Modal content</p>
                </Modal>,
            );
            expect(await axe(container)).toHaveNoViolations();
        });
    });

});

describe('Modal — pinned footer + flex layout (ROK-1655 PR-1)', () => {
    beforeEach(() => {
        document.body.style.overflow = '';
    });
    afterEach(() => {
        document.body.style.overflow = '';
    });

    it('renders the footer as a later sibling of the body, outside the scroll element', () => {
        render(
            <Modal isOpen={true} onClose={vi.fn()} title="Test" footer={<button type="button">Save</button>}>
                <p>Body content</p>
            </Modal>,
        );
        const body = screen.getByText('Body content').parentElement as HTMLElement;
        const footer = screen.queryByTestId('modal-footer');
        expect(footer, 'the footer prop must render a modal-footer element').not.toBeNull();
        expect(footer).toHaveTextContent('Save');
        expect(body).toHaveClass('overflow-y-auto');
        expect(body.nextElementSibling).toBe(footer);
        expect(footer?.closest('.overflow-y-auto')).toBeNull();
        expect(footer).toHaveClass('shrink-0', 'border-t', 'border-edge', 'justify-end');
    });

    it('renders no modal-footer element when the footer prop is omitted', () => {
        render(
            <Modal isOpen={true} onClose={vi.fn()} title="Test">
                <p>Body content</p>
            </Modal>,
        );
        expect(screen.queryByTestId('modal-footer')).toBeNull();
    });
});

describe('Modal — 90dvh flex-column layout (ROK-1655 PR-1)', () => {
    beforeEach(() => {
        document.body.style.overflow = '';
    });
    afterEach(() => {
        document.body.style.overflow = '';
    });

    it('lays the dialog out as a 90dvh flex column with a shrink-0 header', () => {
        render(
            <Modal isOpen={true} onClose={vi.fn()} title="Layout Title">
                <p>Body content</p>
            </Modal>,
        );
        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveClass('flex', 'flex-col', 'max-h-[90dvh]', 'overflow-hidden');
        expect(dialog).not.toHaveClass('max-h-[90vh]');
        expect(screen.getByText('Layout Title').parentElement).toHaveClass('shrink-0');
    });

    it('gives the default body the structural classes plus the p-4 overflow-y-auto skin', () => {
        render(
            <Modal isOpen={true} onClose={vi.fn()} title="Test">
                <p>Body content</p>
            </Modal>,
        );
        const body = screen.getByText('Body content').parentElement as HTMLElement;
        expect(body).toHaveClass('flex-1', 'min-h-0', 'p-4', 'overflow-y-auto');
        expect(body).not.toHaveClass('max-h-[calc(90vh-8rem)]');
    });

    it.each([
        'p-4 pb-6 overflow-y-auto max-h-[calc(90vh-8rem)]',
        'p-4 flex flex-col max-h-[calc(90vh-4rem)]',
        'p-4',
    ])('keeps flex-1 min-h-0 plus the caller skin %s', (skin) => {
        render(
            <Modal isOpen={true} onClose={vi.fn()} title="Test" bodyClassName={skin}>
                <p>Body content</p>
            </Modal>,
        );
        const body = screen.getByText('Body content').parentElement as HTMLElement;
        expect(body).toHaveClass('flex-1', 'min-h-0', ...skin.split(' '));
    });
});
