/**
 * Shared search state + close handler for modal dialogs (ROK-808).
 */
import { useState, useCallback } from 'react';

/** Manages search state and clears it on close. */
export function useModalSearch(onClose: () => void) {
    const [search, setSearch] = useState('');
    const handleClose = useCallback(() => {
        setSearch('');
        onClose();
    }, [onClose]);
    return { search, setSearch, handleClose };
}
