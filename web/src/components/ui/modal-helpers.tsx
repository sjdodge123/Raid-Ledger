/**
 * Shared search input and empty state for modal dialogs (ROK-808).
 * Extracted from HeartedGamesModal, SteamLibraryModal, SteamWishlistModal.
 * `ModalSearchInput` delegates to the shared `SearchInput` (ROK-1647).
 */
import type { JSX } from 'react';
import { SearchInput } from './search-input';

/** Reusable search input for modal lists — a `SearchInput` (ROK-1647). */
export function ModalSearchInput({
    value,
    onChange,
    placeholder = 'Search games...',
    label,
}: {
    value: string;
    /** Accessible name — the input has no visible label. */
    label: string;
    onChange: (value: string) => void;
    placeholder?: string;
}): JSX.Element {
    return (
        <div className="mb-4">
            <SearchInput label={label} placeholder={placeholder} value={value} onChange={onChange} />
        </div>
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
