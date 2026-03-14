/**
 * Shared search input and empty state for modal dialogs (ROK-808).
 * Extracted from HeartedGamesModal, SteamLibraryModal, SteamWishlistModal.
 */
import type { JSX } from 'react';

const INPUT_CLS =
    'w-full px-3 py-2 mb-4 bg-surface/50 border border-edge rounded-lg text-sm text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent';

/** Reusable search input for modal lists. */
export function ModalSearchInput({
    value,
    onChange,
    placeholder = 'Search games...',
}: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
}): JSX.Element {
    return (
        <input
            type="text"
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={INPUT_CLS}
        />
    );
}

/** Reusable "no results" message for modal lists. */
export function ModalEmptyState({
    message = 'No games found',
}: {
    message?: string;
}): JSX.Element {
    return (
        <p className="text-center text-muted text-sm py-4">{message}</p>
    );
}

/** Wraps a filtered list with empty state. */
export function ModalListBody({
    isEmpty,
    children,
}: {
    isEmpty: boolean;
    children: React.ReactNode;
}): JSX.Element {
    return (
        <>
            <div className="flex flex-col gap-2">{children}</div>
            {isEmpty && <ModalEmptyState />}
        </>
    );
}
