/** IGDB platform ID to display name (common ones) */
export const PLATFORM_MAP: Record<number, string> = {
    6: 'PC', 48: 'PS4', 167: 'PS5', 49: 'Xbox One',
    169: 'Xbox Series', 130: 'Switch', 34: 'Android', 39: 'iOS',
    170: 'Stadia', 14: 'Mac', 3: 'Linux',
};

/** IGDB game mode ID to display name */
export const MODE_MAP: Record<number, string> = {
    1: 'Single Player', 2: 'Multiplayer', 3: 'Co-op',
    4: 'Split Screen', 5: 'MMO',
};
