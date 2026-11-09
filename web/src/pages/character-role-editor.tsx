/**
 * Role chip + owner role editor for the character detail header (moved out
 * of `character-detail-page.tsx` for ROK-2140 so both header layouts share it).
 */
import { useState, useEffect, useRef, type JSX } from 'react';
import type { CharacterRole } from '@raid-ledger/contract';
import { useUpdateCharacter } from '../hooks/use-character-mutations';

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

/** The role chip (editable for the owner) and the ★ Main chip. */
export function CharacterRoleBadge({ character, isOwner }: { character: { id: string; effectiveRole?: string | null; roleOverride?: string | null; isMain?: boolean }; isOwner: boolean }): JSX.Element {
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
