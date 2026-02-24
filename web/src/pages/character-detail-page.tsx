import { useParams, useNavigate } from 'react-router-dom';
import { useCharacterDetail } from '../hooks/use-character-detail';
import { useUpdateCharacter } from '../hooks/use-character-mutations';
import { useAuth } from '../hooks/use-auth';
import { useState, useEffect, useRef } from 'react';
import type { CharacterRole } from '@raid-ledger/contract';
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

function RoleEditor({ characterId, effectiveRole, hasOverride }: RoleEditorProps) {
    const [isOpen, setIsOpen] = useState(false);
    const updateMutation = useUpdateCharacter();
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isOpen) return;
        function handleClickOutside(e: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    function handleRoleChange(newRole: CharacterRole | null) {
        updateMutation.mutate({
            id: characterId,
            dto: { roleOverride: newRole },
        });
        setIsOpen(false);
    }

    const roles: Array<{ value: CharacterRole; label: string; color: string }> = [
        { value: 'tank', label: 'TANK', color: 'bg-blue-600' },
        { value: 'healer', label: 'HEALER', color: 'bg-emerald-600' },
        { value: 'dps', label: 'DPS', color: 'bg-red-600' },
    ];

    if (!isOpen) {
        return (
            <span className="inline-flex items-center gap-1">
                <button
                    onClick={() => setIsOpen(true)}
                    className={`px-2 py-0.5 rounded text-xs text-foreground transition-colors ${
                        effectiveRole
                            ? `${ROLE_COLORS[effectiveRole] ?? 'bg-faint'} hover:opacity-80`
                            : 'bg-faint/50 text-muted hover:bg-faint border border-dashed border-edge'
                    }`}
                    title="Click to change role"
                >
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

    return (
        <div className="relative inline-block" ref={dropdownRef}>
            <div className="absolute z-10 top-full mt-1 bg-panel border border-edge rounded-lg shadow-lg p-2 min-w-[140px]">
                {roles.map((r) => (
                    <button
                        key={r.value}
                        onClick={() => handleRoleChange(r.value)}
                        className={`w-full text-left px-3 py-1.5 text-xs rounded transition-colors flex items-center gap-2 ${
                            effectiveRole === r.value
                                ? `${r.color} text-foreground`
                                : 'text-muted hover:bg-overlay hover:text-foreground'
                        }`}
                    >
                        {r.label}
                    </button>
                ))}
                {hasOverride && (
                    <button
                        onClick={() => handleRoleChange(null)}
                        className="w-full text-left px-3 py-1.5 text-xs rounded text-muted hover:bg-overlay hover:text-foreground mt-1 border-t border-edge"
                    >
                        Clear Override
                    </button>
                )}
            </div>
        </div>
    );
}

export function CharacterDetailPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { data: character, isLoading, error } = useCharacterDetail(id);
    const { user } = useAuth();

    const isOwner = user && character && user.id === character.userId;
    const isArmoryImported = !!character?.lastSyncedAt;

    if (isLoading) {
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

    if (error || !character) {
        return (
            <div className="max-w-5xl mx-auto px-4 py-8">
                <div className="bg-red-950/50 border border-red-900 rounded-lg p-6 text-center">
                    <p className="text-red-400">{error?.message ?? 'Character not found'}</p>
                    <button onClick={() => navigate(-1)} className="text-blue-400 hover:underline mt-2 inline-block">
                        Go back
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
            {/* Back link */}
            <button onClick={() => navigate(-1)} className="text-sm text-muted hover:text-foreground transition-colors inline-flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
            </button>

            {/* Character Header */}
            <div className="bg-panel border border-edge rounded-lg p-6">
                <div className="flex items-start gap-4">
                    {/* Large avatar */}
                    {character.avatarUrl ? (
                        <img
                            src={character.avatarUrl}
                            alt={character.name}
                            className="w-20 h-20 rounded-full bg-overlay flex-shrink-0"
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                    ) : (
                        <div className="w-20 h-20 rounded-full bg-overlay flex items-center justify-center text-3xl text-muted flex-shrink-0">
                            👤
                        </div>
                    )}

                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 flex-wrap">
                            <h1 className="text-2xl font-bold text-foreground">{character.name}</h1>
                            {/* Plugin: faction badge, item level, armory link */}
                            <PluginSlot
                                name="character-detail:header-badges"
                                context={{
                                    faction: character.faction,
                                    itemLevel: character.itemLevel,
                                    equippedItemLevel: character.equipment?.equippedItemLevel ?? null,
                                    lastSyncedAt: character.lastSyncedAt,
                                    profileUrl: character.profileUrl,
                                }}
                            />
                            {isOwner ? (
                                <RoleEditor
                                    characterId={character.id}
                                    effectiveRole={character.effectiveRole as CharacterRole | null}
                                    hasOverride={character.roleOverride != null}
                                />
                            ) : character.effectiveRole ? (
                                <span className={`px-2 py-0.5 rounded text-xs text-foreground ${ROLE_COLORS[character.effectiveRole] ?? 'bg-faint'}`}>
                                    {character.effectiveRole.toUpperCase()}
                                </span>
                            ) : null}
                            {character.isMain && (
                                <span className="text-yellow-400 inline-flex items-center gap-1 text-sm font-semibold" title="Main character">⭐ Main</span>
                            )}
                        </div>

                        <div className="flex items-center gap-2 text-sm text-muted mt-1 flex-wrap">
                            {character.level && <span className="text-amber-400">Level {character.level}</span>}
                            {character.race && <><span>·</span><span>{character.race}</span></>}
                            {character.class && <><span>·</span><span>{character.class}</span></>}
                            {character.spec && <><span>·</span><span>{character.spec}</span></>}
                            {character.realm && <><span>·</span><span>{character.realm}</span></>}
                        </div>

                        {/* Plugin: refresh from armory button */}
                        {isOwner && isArmoryImported && (
                            <div className="mt-3">
                                <PluginSlot
                                    name="profile:character-actions"
                                    context={{
                                        characterId: character.id,
                                        lastSyncedAt: character.lastSyncedAt,
                                        region: character.region,
                                        gameVariant: character.gameVariant,
                                    }}
                                />
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Plugin: Equipment Section */}
            <PluginSlot
                name="character-detail:sections"
                context={{
                    equipment: character.equipment,
                    talents: character.talents,
                    gameVariant: character.gameVariant,
                    renderUrl: character.renderUrl,
                    isArmoryImported,
                    characterClass: character.class ?? null,
                }}
                fallback={
                    character.equipment && character.equipment.items.length > 0 ? null : (
                        <div className="bg-panel border border-edge rounded-lg p-6">
                            <h2 className="text-lg font-semibold text-foreground mb-4">Equipment</h2>
                            <div className="text-center py-8 text-muted">
                                <p className="text-lg">No equipment data</p>
                                <p className="text-sm mt-1">Equipment data is available for games with plugin support.</p>
                            </div>
                        </div>
                    )
                }
            />
        </div>
    );
}
