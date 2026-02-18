import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Modal } from './modal';

describe('Modal', () => {
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

    describe('ARIA semantics (ROK-342)', () => {
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
