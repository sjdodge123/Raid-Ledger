import { Fragment } from 'react';
import type {
    CharacterDto,
    CharacterProfessionsDto,
    ProfessionEntryDto,
} from '@raid-ledger/contract';
import { getClassIconUrl } from '../../plugins/wow/lib/class-icons';
import { getProfessionIconUrl } from '../../plugins/wow/lib/profession-icons';

/**
 * ROK-461: Selectable character card for admin assignment flow.
 */
export function SelectableCharacterCard({
    character, isSelected, onSelect, isMain,
}: {
    character: CharacterDto;
    isSelected: boolean;
    onSelect: () => void;
    isMain?: boolean;
}) {
    return (
        <button
            onClick={onSelect}
            className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all text-left ${isSelected
                ? 'border-indigo-500 bg-indigo-500/10'
                : 'border-edge bg-panel/50 hover:border-edge-strong hover:bg-panel'
                }`}
        >
            <CharacterAvatar name={character.name} avatarUrl={character.avatarUrl} />
            <CharacterInfo character={character} isMain={isMain} />
            {isSelected && <SelectedCheckmark />}
        </button>
    );
}

function CharacterAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) {
    if (avatarUrl) {
        return <img src={avatarUrl} alt={name} className="w-10 h-10 rounded-full bg-overlay" />;
    }
    return (
        <div className="w-10 h-10 rounded-full bg-overlay flex items-center justify-center text-lg">
            {name.charAt(0).toUpperCase()}
        </div>
    );
}

function CharacterInfo({ character, isMain }: { character: CharacterDto; isMain?: boolean }) {
    return (
        <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
                <span className="font-medium text-foreground truncate">{character.name}</span>
                {isMain && <span className="text-yellow-400 text-sm" title="Main Character">*</span>}
            </div>
            <div className="flex items-center gap-2 text-sm text-muted">
                {character.level && <span>Lv.{character.level}</span>}
                {character.level && character.class && <span>·</span>}
                {character.class && (
                    <span className="inline-flex items-center gap-1">
                        {getClassIconUrl(character.class) && (
                            <img src={getClassIconUrl(character.class)!} alt="" className="w-4 h-4 rounded-sm" />
                        )}
                        {character.class}
                    </span>
                )}
                {character.spec && (<><span>·</span><span>{character.spec}</span></>)}
                {character.itemLevel && (
                    <><span>·</span><span className="text-purple-400">{character.itemLevel} iLvl</span></>
                )}
                <ProfessionBadges professions={character.professions} />
            </div>
        </div>
    );
}

function ProfessionBadges({ professions }: { professions: CharacterProfessionsDto | null }) {
    if (!professions) return null;
    const all = [...professions.primary, ...professions.secondary];
    if (all.length === 0) return null;
    return (
        <>
            {all.map((entry) => (
                <Fragment key={entry.id}>
                    <span>·</span>
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

function SelectedCheckmark() {
    return (
        <div className="w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center">
            <svg className="w-3 h-3 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
        </div>
    );
}
