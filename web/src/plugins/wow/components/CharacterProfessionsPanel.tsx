import { useState } from 'react';
import type {
    CharacterProfessionsDto,
    ProfessionEntryDto,
    ProfessionTierDto,
} from '@raid-ledger/contract';
import { getProfessionIconUrl } from '../lib/profession-icons';
import { EditProfessionsModal } from './EditProfessionsModal';

interface CharacterProfessionsPanelProps {
    professions: CharacterProfessionsDto | null;
    isOwner: boolean;
    characterId: string;
    gameId: number;
}

function hasProfessionData(professions: CharacterProfessionsDto | null): professions is CharacterProfessionsDto {
    return !!professions && (professions.primary.length > 0 || professions.secondary.length > 0);
}

export function CharacterProfessionsPanel({
    professions, isOwner, characterId, gameId,
}: CharacterProfessionsPanelProps) {
    const [isEditing, setIsEditing] = useState(false);
    const hasData = hasProfessionData(professions);
    if (!hasData && !isOwner) return null;
    const openEdit = () => setIsEditing(true);
    return (
        <>
            <div className="bg-panel border border-edge rounded-lg p-6">
                <PanelHeader showEdit={isOwner && hasData} onEdit={openEdit} />
                {hasData ? <ProfessionsBody professions={professions} /> : <AddProfessionsCta onAdd={openEdit} />}
            </div>
            {isOwner && (
                <EditProfessionsModal isOpen={isEditing} onClose={() => setIsEditing(false)}
                    characterId={characterId} gameId={gameId} initial={professions} />
            )}
        </>
    );
}

function PanelHeader({ showEdit, onEdit }: { showEdit: boolean; onEdit: () => void }) {
    return (
        <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">Professions</h2>
            {showEdit && (
                <button type="button" onClick={onEdit}
                    className="text-sm text-indigo-400 hover:text-indigo-300">
                    Edit
                </button>
            )}
        </div>
    );
}

function ProfessionsBody({ professions }: { professions: CharacterProfessionsDto }) {
    return (
        <div className="space-y-6">
            {professions.primary.length > 0 && (
                <ProfessionGroup heading="Primary" entries={professions.primary} />
            )}
            {professions.secondary.length > 0 && (
                <ProfessionGroup heading="Secondary" entries={professions.secondary} />
            )}
        </div>
    );
}

function AddProfessionsCta({ onAdd }: { onAdd: () => void }) {
    return (
        <div className="text-center py-6 text-muted">
            <p className="text-sm mb-3">No profession data yet.</p>
            <button type="button" onClick={onAdd}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-foreground font-medium rounded-lg transition-colors">
                Add Professions
            </button>
        </div>
    );
}

function ProfessionGroup({
    heading, entries,
}: {
    heading: string;
    entries: ProfessionEntryDto[];
}) {
    return (
        <section>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted mb-2">{heading}</h3>
            <ul className="space-y-3">
                {entries.map((entry) => (
                    <li key={entry.id}>
                        <ProfessionRow entry={entry} />
                    </li>
                ))}
            </ul>
        </section>
    );
}

function ProfessionRow({ entry }: { entry: ProfessionEntryDto }) {
    const iconUrl = getProfessionIconUrl(entry.slug);
    return (
        <div>
            <div className="flex items-center gap-2 text-foreground">
                {iconUrl && (
                    <img src={iconUrl} alt={entry.name} className="w-6 h-6 rounded-sm" />
                )}
                <span className="font-medium">{entry.name}</span>
                <span className="text-sm text-muted">
                    {entry.skillLevel}/{entry.maxSkillLevel}
                </span>
            </div>
            {entry.tiers.length > 0 && <ProfessionTierList tiers={entry.tiers} />}
        </div>
    );
}

function ProfessionTierList({ tiers }: { tiers: ProfessionTierDto[] }) {
    return (
        <ul className="mt-2 ml-8 space-y-1 text-sm text-muted">
            {tiers.map((tier) => (
                <li key={tier.id} className="flex items-center gap-2">
                    <span>{tier.name}</span>
                    <span>{tier.skillLevel}/{tier.maxSkillLevel}</span>
                </li>
            ))}
        </ul>
    );
}
