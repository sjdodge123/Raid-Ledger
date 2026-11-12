import { useSyncExternalStore } from 'react';

function subscribe(callback: () => void): () => void {
    document.addEventListener('visibilitychange', callback);
    return () => document.removeEventListener('visibilitychange', callback);
}

const getSnapshot = (): boolean => document.hidden;
const getServerSnapshot = (): boolean => false;

/** True while the page is in a background tab or minimised (`document.hidden`). ROK-2187. */
export function useDocumentHidden(): boolean {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
