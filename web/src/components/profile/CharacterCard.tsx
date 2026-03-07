import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { CharacterDto } from '@raid-ledger/contract';
import { useDeleteCharacter } from '../../hooks/use-character-mutations';
import { PluginSlot } from '../../plugins';

interface CharacterCardProps {
    character: CharacterDto;
    onEdit: (character: CharacterDto) => void;
}

const FACTION_STYLES: Record<string, string> = {
    alliance: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    horde: 'bg-red-500/20 text-red-400 border-red-500/30',
};

/** ROK-587: Short labels for WoW Classic game variants */
const VARIANT_LABELS: Record<string, string> = {
    classic_anniversary: 'TBC',
    classic_era: 'Era',
    classic: 'Cata',
};

const ROLE_COLORS: Record<string, string> = {
    tank: 'bg-blue-600',
    healer: 'bg-emerald-600',
    dps: 'bg-red-600',
};

function buildPluginContext(character: CharacterDto) {
    return {
        characterId: character.id,
        lastSyncedAt: character.lastSyncedAt,
        region: character.region,
        gameVariant: character.gameVariant,
        profileUrl: character.profileUrl,
    };
}

function CharacterNameBadges({ character }: { character: CharacterDto }) {
    return (
        <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-foreground truncate max-w-[180px] sm:max-w-none">
                {character.name}
            </span>
            {character.isMain && (
                <span className="md:hidden text-yellow-400 text-xs font-semibold inline-flex items-center gap-0.5 flex-shrink-0" title="Main character">
                    ⭐ Main
                </span>
            )}
            {character.faction && (
                <span className={`px-1.5 py-0.5 rounded text-xs font-medium border flex-shrink-0 ${FACTION_STYLES[character.faction] ?? 'bg-faint text-muted'}`}>
                    {character.faction.charAt(0).toUpperCase() + character.faction.slice(1)}
                </span>
            )}
            {character.gameVariant && VARIANT_LABELS[character.gameVariant] && (
                <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30 flex-shrink-0">
                    {VARIANT_LABELS[character.gameVariant]}
                </span>
            )}
        </div>
    );
}

function CharacterMetaRow({ character }: { character: CharacterDto }) {
    return (
        <div className="flex items-center gap-1.5 text-sm text-muted flex-wrap">
            {character.level && (
                <>
                    <span className="text-amber-400">Lv.{character.level}</span>
                    <span>•</span>
                </>
            )}
            {character.race && <span className="truncate max-w-[100px] sm:max-w-none">{character.race}</span>}
            {character.race && character.class && <span>•</span>}
            {character.class && <span className="truncate max-w-[100px] sm:max-w-none">{character.class}</span>}
            {character.spec && <span className="truncate max-w-[80px] sm:max-w-none">• {character.spec}</span>}
            {character.effectiveRole && (
                <span className={`px-1.5 py-0.5 rounded text-xs text-foreground flex-shrink-0 ${ROLE_COLORS[character.effectiveRole] || 'bg-faint'}`}>
                    {character.effectiveRole.toUpperCase()}
                </span>
            )}
            {character.itemLevel && (
                <>
                    <span>•</span>
                    <span className="text-purple-400 whitespace-nowrap">{character.itemLevel} iLvl</span>
                </>
            )}
        </div>
    );
}

function CharacterInfoLink({ character }: { character: CharacterDto }) {
    return (
        <Link to={`/characters/${character.id}`} className="flex items-center gap-3 min-w-0 hover:opacity-80 transition-opacity">
            {character.avatarUrl ? (
                <img src={character.avatarUrl} alt={character.name} className="w-10 h-10 rounded-full bg-overlay"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            ) : (
                <div className="w-10 h-10 rounded-full bg-overlay flex items-center justify-center text-muted">👤</div>
            )}
            <div className="min-w-0 overflow-hidden">
                <CharacterNameBadges character={character} />
                <CharacterMetaRow character={character} />
            </div>
        </Link>
    );
}

function KebabButton({ onClick }: { onClick: () => void }) {
    return (
        <button onClick={onClick}
            className="md:hidden w-[44px] h-[44px] flex items-center justify-center text-muted hover:text-foreground hover:bg-overlay rounded transition-colors"
            aria-label="Character actions">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                <circle cx="10" cy="4" r="1.5" /><circle cx="10" cy="10" r="1.5" /><circle cx="10" cy="16" r="1.5" />
            </svg>
        </button>
    );
}

function DesktopActions({ character, onEdit, onDelete, isDeleting }: {
    character: CharacterDto; onEdit: () => void; onDelete: () => void; isDeleting: boolean;
}) {
    return (
        <div className="hidden md:flex items-center gap-2">
            {character.isMain && (
                <span className="text-yellow-400 text-sm font-semibold inline-flex items-center gap-1" title="Main character">⭐ Main</span>
            )}
            <PluginSlot name="profile:character-actions" context={buildPluginContext(character)} />
            <button onClick={onEdit} className="px-3 py-1.5 text-sm text-secondary hover:text-foreground hover:bg-overlay rounded transition-colors">Edit</button>
            <button onClick={onDelete} disabled={isDeleting}
                className="px-3 py-1.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-950/50 rounded transition-colors">Delete</button>
        </div>
    );
}

function MobileActionsPanel({ character, onEdit, onDelete, isDeleting, onClose }: {
    character: CharacterDto; onEdit: () => void; onDelete: () => void; isDeleting: boolean; onClose: () => void;
}) {
    return (
        <div className="md:hidden border-t border-edge" data-testid="mobile-actions-panel">
            <div className="flex items-center justify-evenly px-2 py-1">
                <PluginSlot name="profile:character-actions" context={buildPluginContext(character)} />
                <button onClick={() => { onClose(); onEdit(); }}
                    className="min-w-[44px] min-h-[44px] px-4 py-2 text-sm text-secondary hover:text-foreground hover:bg-overlay rounded transition-colors">Edit</button>
                <button onClick={() => { onClose(); onDelete(); }} disabled={isDeleting}
                    className="min-w-[44px] min-h-[44px] px-4 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-950/50 rounded transition-colors">Delete</button>
            </div>
        </div>
    );
}

/**
 * Card displaying a single character with actions.
 * Enhanced for ROK-234: shows level, race, faction badge for Armory-imported characters.
 * Click-through to character detail page for equipment view.
 * ROK-206: "Set as main" moved into Edit Character modal.
 * ROK-338: Mobile actions use accordion panel instead of overlay dropdown.
 */
export function CharacterCard({ character, onEdit }: CharacterCardProps) {
    const deleteMutation = useDeleteCharacter();
    const [menuOpen, setMenuOpen] = useState(false);

    const handleDelete = () => {
        if (window.confirm(`Are you sure you want to delete ${character.name}?`)) deleteMutation.mutate(character.id);
    };

    return (
        <div className="bg-panel border border-edge rounded-lg">
            <div className="p-4 flex items-center justify-between gap-4">
                <CharacterInfoLink character={character} />
                <div className="flex-shrink-0">
                    <KebabButton onClick={() => setMenuOpen((v) => !v)} />
                    <DesktopActions character={character} onEdit={() => onEdit(character)} onDelete={handleDelete} isDeleting={deleteMutation.isPending} />
                </div>
            </div>
            {menuOpen && <MobileActionsPanel character={character} onEdit={() => onEdit(character)} onDelete={handleDelete}
                isDeleting={deleteMutation.isPending} onClose={() => setMenuOpen(false)} />}
        </div>
    );
}
