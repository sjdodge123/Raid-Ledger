import { getClassIconUrl } from '../lib/class-icons';

/**
 * ROK-2359 — the WoW class icon on core character / roster cards, through the
 * `character-card:class-icon` slot (core cards no longer import `class-icons`).
 * Context: `characterClass` (the class name) and `iconClassName` (the card's
 * size + shape classes, so each card keeps its own sizing). An unknown class
 * renders nothing, so the card's inline row is unchanged.
 */
export function CharacterClassIcon({ characterClass, iconClassName }: {
    characterClass?: string | null | undefined;
    iconClassName?: string | undefined;
}) {
    const url = getClassIconUrl(characterClass);
    if (!url) return null;
    return <img src={url} alt="" className={iconClassName ?? 'w-4 h-4 rounded-sm flex-shrink-0'} />;
}
