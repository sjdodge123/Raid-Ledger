import type { CharacterDto, CharacterRole } from '@raid-ledger/contract';
import { RoleIcon } from '../shared/RoleIcon';

const ROLE_COLORS: Record<CharacterRole, string> = {
    tank: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    healer: 'bg-green-500/20 text-green-400 border-green-500/30',
    dps: 'bg-red-500/20 text-red-400 border-red-500/30',
};

interface SignupCharacterCardProps {
    character: CharacterDto;
    isSelected: boolean;
    onSelect: () => void;
    isMain?: boolean;
}

function CharacterAvatar({ character }: { character: CharacterDto }) {
    if (character.avatarUrl) {
        return <img src={character.avatarUrl} alt={character.name} className="w-10 h-10 rounded-full bg-overlay" />;
    }
    return (
        <div className="w-10 h-10 rounded-full bg-overlay flex items-center justify-center text-lg">
            {character.name.charAt(0).toUpperCase()}
        </div>
    );
}

function CharacterDetails({ character, isMain }: { character: CharacterDto; isMain?: boolean }) {
    return (
        <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
                <span className="font-medium text-foreground truncate">{character.name}</span>
                {isMain && <span className="text-yellow-400 text-sm" title="Main Character">⭐</span>}
                {character.faction && (
                    <span className={`px-1 py-0.5 rounded text-xs ${character.faction === 'horde' ? 'text-red-400' : 'text-blue-400'}`}>
                        {character.faction === 'horde' ? 'H' : 'A'}
                    </span>
                )}
            </div>
            <CharacterStats character={character} />
        </div>
    );
}

function CharacterStats({ character }: { character: CharacterDto }) {
    return (
        <div className="flex items-center gap-2 text-sm text-muted truncate">
            {character.level && <span className="shrink-0">Lv.{character.level}</span>}
            {character.level && character.class && <span className="shrink-0">·</span>}
            {character.class && <span className="truncate">{character.class}</span>}
            {character.spec && <><span className="shrink-0">·</span><span className="truncate">{character.spec}</span></>}
            {character.itemLevel && <><span className="shrink-0">·</span><span className="shrink-0 text-purple-400">{character.itemLevel} iLvl</span></>}
        </div>
    );
}

function SelectedCheckmark() {
    return (
        <div className="shrink-0 w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center">
            <svg className="w-3 h-3 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
        </div>
    );
}

export function SignupCharacterCard({ character, isSelected, onSelect, isMain }: SignupCharacterCardProps) {
    const role = character.effectiveRole as CharacterRole | null;

    return (
        <button onClick={onSelect}
            className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all text-left ${isSelected
                ? 'border-indigo-500 bg-indigo-500/10' : 'border-edge bg-panel/50 hover:border-edge-strong hover:bg-panel'}`}>
            <CharacterAvatar character={character} />
            <CharacterDetails character={character} isMain={isMain} />
            {role && (
                <span className={`shrink-0 px-2 py-1 text-xs font-medium rounded border whitespace-nowrap ${ROLE_COLORS[role]}`}>
                    <RoleIcon role={role} size="w-3.5 h-3.5" /> {role.charAt(0).toUpperCase() + role.slice(1)}
                </span>
            )}
            {isSelected && <SelectedCheckmark />}
        </button>
    );
}
