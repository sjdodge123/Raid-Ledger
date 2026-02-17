import { createContext } from 'react';

export interface InterestEntry {
    wantToPlay: boolean;
    count: number;
}

export interface WantToPlayContextValue {
    getInterest: (gameId: number) => InterestEntry;
    toggle: (gameId: number, wantToPlay: boolean) => void;
    isToggling: boolean;
}

export const defaultEntry: InterestEntry = { wantToPlay: false, count: 0 };

/** Sentinel value — when context is this, we know no provider is mounted */
export const NO_PROVIDER: WantToPlayContextValue = {
    getInterest: () => defaultEntry,
    toggle: () => {},
    isToggling: false,
};

export const WantToPlayContext = createContext<WantToPlayContextValue>(NO_PROVIDER);
