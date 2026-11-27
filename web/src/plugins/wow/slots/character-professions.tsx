import type { CharacterProfessionsDto } from '@raid-ledger/contract';
import { ProfessionBadges } from '../components/ProfessionBadges';

/**
 * ROK-2359 — the WoW profession pills on core character / roster cards,
 * through the `character-card:professions` slot. Context: `professions` and an
 * optional `separator` (forwarded to `ProfessionBadges`, which keeps its own
 * middle-dot default).
 */
export function CharacterProfessions({ professions, separator }: {
    professions?: CharacterProfessionsDto | null | undefined;
    separator?: string | undefined;
}) {
    return <ProfessionBadges professions={professions ?? null} {...(separator !== undefined ? { separator } : {})} />;
}
