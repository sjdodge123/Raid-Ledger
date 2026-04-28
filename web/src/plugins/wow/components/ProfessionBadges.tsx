import { Fragment } from 'react';
import type {
    CharacterProfessionsDto,
    ProfessionEntryDto,
} from '@raid-ledger/contract';
import { getProfessionIconUrl } from '../lib/profession-icons';

/**
 * Inline pills showing one badge per profession (primary first, then
 * secondary). Returns `null` when professions is null or both arrays
 * are empty so the parent meta row is byte-identical to a baseline
 * card without the field (see architect §8 in ROK-1130).
 *
 * Pre-baked icon URLs come from `profession-icons.ts`. When the slug
 * isn't in the map, the pill falls back to text-only (`{name} {skill}`).
 */
export function ProfessionBadges({
    professions,
    separator = '·',
}: {
    professions: CharacterProfessionsDto | null | undefined;
    /** Visual separator between pills; defaults to a middle dot to match meta rows. */
    separator?: string;
}) {
    if (!professions) return null;
    const all = [...professions.primary, ...professions.secondary];
    if (all.length === 0) return null;
    return (
        <>
            {all.map((entry) => (
                <Fragment key={entry.id}>
                    <span>{separator}</span>
                    <ProfessionPill entry={entry} />
                </Fragment>
            ))}
        </>
    );
}

function ProfessionPill({ entry }: { entry: ProfessionEntryDto }) {
    const iconUrl = getProfessionIconUrl(entry.slug);
    const title = `${entry.name} ${entry.skillLevel}/${entry.maxSkillLevel}`;
    if (!iconUrl) {
        return <span title={title}>{entry.name} {entry.skillLevel}</span>;
    }
    return (
        <span className="inline-flex items-center gap-1" title={title}>
            <img src={iconUrl} alt={entry.name} className="w-4 h-4" />
            {entry.skillLevel}
        </span>
    );
}
