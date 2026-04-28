import { useParams, useNavigate } from 'react-router-dom';
import { useCharacterDetail } from '../hooks/use-character-detail';
import { useUpdateCharacter } from '../hooks/use-character-mutations';
import { useAuth } from '../hooks/use-auth';
import { useState, useEffect, useRef } from 'react';
import type { CharacterRole, CharacterDto } from '@raid-ledger/contract';
import { PluginSlot } from '../plugins';

const ROLE_COLORS: Record<string, string> = {
    tank: 'bg-blue-600',
    healer: 'bg-emerald-600',
    dps: 'bg-red-600',
};

interface RoleEditorProps {
    characterId: string;
    effectiveRole: CharacterRole | null;
    hasOverride: boolean;
}

const ROLE_OPTIONS: Array<{ value: CharacterRole; label: string; color: string }> = [
    { value: 'tank', label: 'TANK', color: 'bg-blue-600' },
    { value: 'healer', label: 'HEALER', color: 'bg-emerald-600' },
    { value: 'dps', label: 'DPS', color: 'bg-red-600' },
];

function useClickOutside(ref: React.RefObject<HTMLDivElement | null>, onClose: () => void, isOpen: boolean) {
    useEffect(() => {
        if (!isOpen) return;
        function handleClickOutside(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen, ref, onClose]);
}

function RoleEditorClosed({ effectiveRole, hasOverride, onOpen }: { effectiveRole: CharacterRole | null; hasOverride: boolean; onOpen: () => void }) {
    return (
        <span className="inline-flex items-center gap-1">
            <button onClick={onOpen}
                className={`px-2 py-0.5 rounded text-xs text-foreground transition-colors ${effectiveRole ? `${ROLE_COLORS[effectiveRole] ?? 'bg-faint'} hover:opacity-80` : 'bg-faint/50 text-muted hover:bg-faint border border-dashed border-edge'}`}
                title="Click to change role">
                {effectiveRole ? effectiveRole.toUpperCase() : 'Set Role'}
            </button>
            {hasOverride && (
                <span className="text-xs text-amber-400" title="Manual role override active">
                    <svg className="w-3 h-3 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                </span>
            )}
        </span>
    );
}

function RoleDropdown({ effectiveRole, hasOverride, onRoleChange, dropdownRef }: {
    effectiveRole: CharacterRole | null; hasOverride: boolean; onRoleChange: (r: CharacterRole | null) => void; dropdownRef: React.RefObject<HTMLDivElement | null>;
}) {
    return (
        <div className="relative inline-block" ref={dropdownRef}>
            <div className="absolute z-10 top-full mt-1 bg-panel border border-edge rounded-lg shadow-lg p-2 min-w-[140px]">
                {ROLE_OPTIONS.map((r) => (
                    <button key={r.value} onClick={() => onRoleChange(r.value)}
                        className={`w-full text-left px-3 py-1.5 text-xs rounded transition-colors flex items-center gap-2 ${effectiveRole === r.value ? `${r.color} text-foreground` : 'text-muted hover:bg-overlay hover:text-foreground'}`}>
                        {r.label}
                    </button>
                ))}
                {hasOverride && (
                    <button onClick={() => onRoleChange(null)} className="w-full text-left px-3 py-1.5 text-xs rounded text-muted hover:bg-overlay hover:text-foreground mt-1 border-t border-edge">
                        Clear Override
                    </button>
                )}
            </div>
        </div>
    );
}

function RoleEditor({ characterId, effectiveRole, hasOverride }: RoleEditorProps) {
    const [isOpen, setIsOpen] = useState(false);
    const updateMutation = useUpdateCharacter();
    const dropdownRef = useRef<HTMLDivElement>(null);
    useClickOutside(dropdownRef, () => setIsOpen(false), isOpen);

    const handleRoleChange = (newRole: CharacterRole | null) => { updateMutation.mutate({ id: characterId, dto: { roleOverride: newRole } }); setIsOpen(false); };

    if (!isOpen) return <RoleEditorClosed effectiveRole={effectiveRole} hasOverride={hasOverride} onOpen={() => setIsOpen(true)} />;
    return <RoleDropdown effectiveRole={effectiveRole} hasOverride={hasOverride} onRoleChange={handleRoleChange} dropdownRef={dropdownRef} />;
}

function CharacterDetailLoading() {
    return (
        <div className="max-w-5xl mx-auto px-4 py-8">
            <div className="animate-pulse space-y-4">
                <div className="h-8 w-48 bg-overlay rounded" />
                <div className="h-32 bg-overlay rounded-lg" />
                <div className="h-64 bg-overlay rounded-lg" />
            </div>
        </div>
    );
}

function CharacterDetailError({ message, onBack }: { message: string; onBack: () => void }) {
    return (
        <div className="max-w-5xl mx-auto px-4 py-8">
            <div className="bg-red-950/50 border border-red-900 rounded-lg p-6 text-center">
                <p className="text-red-400">{message}</p>
                <button onClick={onBack} className="text-blue-400 hover:underline mt-2 inline-block">Go back</button>
            </div>
        </div>
    );
}

function CharacterAvatar({ avatarUrl, name }: { avatarUrl: string | null; name: string }) {
    if (avatarUrl) return <img src={avatarUrl} alt={name} className="w-20 h-20 rounded-full bg-overlay flex-shrink-0" onError={(e) => { e.currentTarget.style.display = 'none'; }} />;
    return <div className="w-20 h-20 rounded-full bg-overlay flex items-center justify-center text-3xl text-muted flex-shrink-0">&#128100;</div>;
}

function CharacterMeta({ character }: { character: { level?: number | null; race?: string | null; class?: string | null; spec?: string | null; realm?: string | null } }) {
    return (
        <div className="flex items-center gap-2 text-sm text-muted mt-1 flex-wrap">
            {character.level && <span className="text-amber-400">Level {character.level}</span>}
            {character.race && <><span>·</span><span>{character.race}</span></>}
            {character.class && <><span>·</span><span>{character.class}</span></>}
            {character.spec && <><span>·</span><span>{character.spec}</span></>}
            {character.realm && <><span>·</span><span>{character.realm}</span></>}
        </div>
    );
}

function CharacterRoleBadge({ character, isOwner }: { character: { id: string; effectiveRole?: string | null; roleOverride?: string | null; isMain?: boolean }; isOwner: boolean }) {
    return (
        <>
            {isOwner ? (
                <RoleEditor characterId={character.id} effectiveRole={character.effectiveRole as CharacterRole | null} hasOverride={character.roleOverride != null} />
            ) : character.effectiveRole ? (
                <span className={`px-2 py-0.5 rounded text-xs text-foreground ${ROLE_COLORS[character.effectiveRole] ?? 'bg-faint'}`}>{character.effectiveRole.toUpperCase()}</span>
            ) : null}
            {character.isMain && <span className="text-yellow-400 inline-flex items-center gap-1 text-sm font-semibold" title="Main character">&#11088; Main</span>}
        </>
    );
}

function CharacterHeader({ character, isOwner, isArmoryImported }: { character: CharacterDto; isOwner: boolean; isArmoryImported: boolean }) {
    return (
        <div className="bg-panel border border-edge rounded-lg p-6">
            <div className="flex items-start gap-4">
                <CharacterAvatar avatarUrl={character.avatarUrl} name={character.name} />
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                        <h1 className="text-2xl font-bold text-foreground">{character.name}</h1>
                        <PluginSlot name="character-detail:header-badges" context={{ faction: character.faction, itemLevel: character.itemLevel, equippedItemLevel: character.equipment?.equippedItemLevel ?? null, lastSyncedAt: character.lastSyncedAt, profileUrl: character.profileUrl }} />
                        <CharacterRoleBadge character={character} isOwner={isOwner} />
                    </div>
                    <CharacterMeta character={character} />
                    {isOwner && isArmoryImported && (
                        <div className="mt-3"><PluginSlot name="profile:character-actions" context={{ characterId: character.id, lastSyncedAt: character.lastSyncedAt, region: character.region, gameVariant: character.gameVariant }} /></div>
                    )}
                </div>
            </div>
        </div>
    );
}

function CharacterEquipmentSection({ character, isArmoryImported }: { character: CharacterDto; isArmoryImported: boolean }) {
    return (
        <PluginSlot name="character-detail:sections"
            context={{ equipment: character.equipment, talents: character.talents, professions: character.professions, gameVariant: character.gameVariant, renderUrl: character.renderUrl, isArmoryImported, characterClass: character.class ?? null, enrichments: character.enrichments ?? [] }}
            fallback={character.equipment?.items.length ? null : (
                <div className="bg-panel border border-edge rounded-lg p-6">
                    <h2 className="text-lg font-semibold text-foreground mb-4">Equipment</h2>
                    <div className="text-center py-8 text-muted"><p className="text-lg">No equipment data</p><p className="text-sm mt-1">Equipment data is available for games with plugin support.</p></div>
                </div>
            )} />
    );
}

export function CharacterDetailPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { data: character, isLoading, error } = useCharacterDetail(id);
    const { user } = useAuth();

    if (isLoading) return <CharacterDetailLoading />;
    if (error || !character) return <CharacterDetailError message={error?.message ?? 'Character not found'} onBack={() => navigate(-1)} />;

    const isOwner = !!(user && user.id === character.userId);
    const isArmoryImported = !!character.lastSyncedAt;

    return (
        <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
            <button onClick={() => navigate(-1)} className="text-sm text-muted hover:text-foreground transition-colors inline-flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg> Back
            </button>
            <CharacterHeader character={character} isOwner={isOwner} isArmoryImported={isArmoryImported} />
            <CharacterEquipmentSection character={character} isArmoryImported={isArmoryImported} />
        </div>
    );
}
