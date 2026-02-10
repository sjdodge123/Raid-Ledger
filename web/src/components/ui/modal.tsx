import { useEffect, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
    /** Override the default max-width (default: 'max-w-md') */
    maxWidth?: string;
}

/**
 * Simple modal component for dialogs.
 * Uses portal pattern for proper z-index stacking.
 */
export function Modal({ isOpen, onClose, title, children, maxWidth = 'max-w-md' }: ModalProps) {
    // Close on Escape key
    const handleKeyDown = useCallback(
        (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        },
        [onClose]
    );

    useEffect(() => {
        if (isOpen) {
            document.addEventListener('keydown', handleKeyDown);
            document.body.style.overflow = 'hidden';
        }
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = '';
        };
    }, [isOpen, handleKeyDown]);

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
                aria-hidden="true"
            />

            {/* Modal Content */}
            <div
                className={`relative bg-surface border border-edge rounded-xl shadow-2xl ${maxWidth} w-full mx-4 max-h-[90vh] overflow-hidden`}
                role="dialog"
                aria-modal="true"
                aria-labelledby="modal-title"
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-edge">
                    <h2 id="modal-title" className="text-lg font-semibold text-foreground">
                        {title}
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-1 text-muted hover:text-foreground transition-colors rounded-lg hover:bg-panel"
                        aria-label="Close modal"
                    >
                        <svg
                            className="w-5 h-5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M6 18L18 6M6 6l12 12"
                            />
                        </svg>
                    </button>
                </div>

                {/* Body */}
                <div className="p-4 overflow-y-auto max-h-[calc(90vh-8rem)]">
                    {children}
                </div>
            </div>
        </div>,
        document.body,
    );
}
