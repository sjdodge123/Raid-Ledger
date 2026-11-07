import { useId, useState } from 'react';
import type {
    CharacterDto,
    CharacterProfessionsDto,
    ProfessionEntryDto,
    ProfessionTierDto,
} from '@raid-ledger/contract';
import { getProfessionIconUrl } from '../lib/profession-icons';
import { EditProfessionsModal } from './EditProfessionsModal';
import { Pill } from '../../../components/hub/hub-bits';
import { sourceLabel } from '../hub-widgets/professions.helpers';

/** ROK-2107 — where the shown (effective) professions came from; null/undefined = unknown. */
export type ProfessionsSource = CharacterDto['professionsSource'];

interface CharacterProfessionsPanelProps {
    professions: CharacterProfessionsDto | null;
    isOwner: boolean;
    characterId: string;
    gameId: number;
    /** ROK-2107 — provenance of `professions`; renders an "Armory" / "Manual" pill when set. */
    source?: ProfessionsSource;
}

function hasProfessionData(professions: CharacterProfessionsDto | null): professions is CharacterProfessionsDto {
    return !!professions && (professions.primary.length > 0 || professions.secondary.length > 0);
}

export function CharacterProfessionsPanel({
    professions, isOwner, characterId, gameId, source,
}: CharacterProfessionsPanelProps) {
    const [isEditing, setIsEditing] = useState(false);
    const headingId = useId();
    const hasData = hasProfessionData(professions);
    if (!hasData && !isOwner) return null;
    const openEdit = () => setIsEditing(true);
    // ROK-2107 review r3 — Blizzard wins: a hand entry is not served while the
    // Armory has professions, so the Edit control is hidden for an Armory value.
    const armorySynced = hasData && source === 'blizzard';
    return (
        <>
            <section aria-labelledby={headingId} className="bg-panel border border-edge rounded-lg p-6">
                <PanelHeader headingId={headingId} showEdit={isOwner && hasData && !armorySynced} onEdit={openEdit}
                    source={hasData ? source ?? null : null} />
                {isOwner && armorySynced && <ArmorySyncedNote />}
                {hasData ? <ProfessionsBody professions={professions} /> : <AddProfessionsCta onAdd={openEdit} />}
            </section>
            {/* Mounted only while editing: the drafts are useState initialisers, so
                every open (after Discard, or after Save + refetch) starts from `professions`. */}
            {isOwner && isEditing && (
                <EditProfessionsModal isOpen onClose={() => setIsEditing(false)}
                    characterId={characterId} gameId={gameId} initial={professions} />
            )}
        </>
    );
}

interface PanelHeaderProps {
    headingId: string;
    showEdit: boolean;
    onEdit: () => void;
    source: ProfessionsSource | null;
}

const SOURCE_TITLE = {
    blizzard: 'Synced from the Blizzard Armory',
    manual: 'Entered by hand; shown until the Armory reports professions',
} as const;

/** "Armory" / "Manual" — the hub widget's per-member source copy, capitalised. */
function professionsSourceLabel(source: 'manual' | 'blizzard'): string {
    const label = sourceLabel(source);
    return label.charAt(0).toUpperCase() + label.slice(1);
}

function PanelHeader({ headingId, showEdit, onEdit, source }: PanelHeaderProps) {
    return (
        <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
                <h2 id={headingId} className="text-lg font-semibold text-foreground">Professions</h2>
                {source && <Pill title={SOURCE_TITLE[source]}>{professionsSourceLabel(source)}</Pill>}
            </div>
            {showEdit && (
                <button type="button" onClick={onEdit}
                    className="text-sm text-indigo-400 hover:text-indigo-300">
                    Edit
                </button>
            )}
        </div>
    );
}

function ArmorySyncedNote() {
    return (
        <p className="-mt-2 mb-4 text-xs text-muted">
            Synced from the Armory — hand entry applies only when the Armory has no professions.
        </p>
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
                    <img src={iconUrl} alt={entry.name} width={24} height={24} loading="lazy" decoding="async" className="w-6 h-6 rounded-sm" />
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
