/**
 * ROK-1747: WoW: Forever race+gender portrait icons.
 *
 * Probed 2026-10-15 for all 10 Classic races x 2 genders: Wowhead's zamimg CDN
 * returns 200 for every `race_<token>_<gender>.jpg`, while Blizzard's
 * render.worldofwarcraft.com icons/56 path 403s nightelf, bloodelf and scourge —
 * so zamimg is the host (already in CSP img-src). zamimg 404s `race_undead_*`;
 * the game-file token is `scourge`, hence the Undead mapping below.
 *
 * No allowlist beyond these races: an unmapped race (Skyborne, Goblin) returns
 * null and the caller falls back to the class tile — a race icon is never guessed.
 */
const RACE_ICON_BASE = 'https://wow.zamimg.com/images/wow/icons/large';

/** Armory display name OR addon token (normalised) → Wowhead game-file token. */
const RACE_TOKENS: Readonly<Record<string, string>> = {
    human: 'human',
    dwarf: 'dwarf',
    nightelf: 'nightelf',
    gnome: 'gnome',
    draenei: 'draenei',
    orc: 'orc',
    undead: 'scourge',
    scourge: 'scourge',
    tauren: 'tauren',
    troll: 'troll',
    bloodelf: 'bloodelf',
};

const GENDERS: ReadonlySet<string> = new Set(['male', 'female']);

/** The race+gender icon URL, or null when either is missing or unmapped. */
export function getRaceIconUrl(race: string | null | undefined, gender: string | null | undefined): string | null {
    const token = RACE_TOKENS[(race ?? '').toLowerCase().replace(/[\s_-]/g, '')];
    const g = (gender ?? '').trim().toLowerCase();
    if (!token || !GENDERS.has(g)) return null;
    return `${RACE_ICON_BASE}/race_${token}_${g}.jpg`;
}
