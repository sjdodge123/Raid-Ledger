import { useState } from 'react';
import type {
    CharacterProfessionsDto,
    ProfessionEntryDto,
} from '@raid-ledger/contract';
import { Modal } from '../../../components/ui/modal';
import { useUpdateCharacter } from '../../../hooks/use-character-mutations';
import { useGameRegistry } from '../../../hooks/use-game-registry';
import { professionNameToSlug } from '../lib/profession-icons';
import { getMaxProfessionSkill } from '../lib/profession-max-skill';

interface EditProfessionsModalProps {
    isOpen: boolean;
    onClose: () => void;
    characterId: string;
    gameId: number;
    initial: CharacterProfessionsDto | null;
}

/** Known retail profession names — used as `<datalist>` suggestions; free-text still allowed. */
const PROFESSION_SUGGESTIONS = [
    'Alchemy', 'Blacksmithing', 'Enchanting', 'Engineering', 'Herbalism',
    'Inscription', 'Jewelcrafting', 'Leatherworking', 'Mining', 'Skinning',
    'Tailoring', 'Cooking', 'Fishing', 'First Aid', 'Archaeology',
];

interface DraftEntry {
    name: string;
    skillLevel: number;
}

function emptyEntry(): DraftEntry {
    return { name: '', skillLevel: 0 };
}

function entriesToDraft(entries: ProfessionEntryDto[]): DraftEntry[] {
    return entries.map((e) => ({ name: e.name, skillLevel: e.skillLevel }));
}

function draftToEntries(drafts: DraftEntry[], maxSkill: number): ProfessionEntryDto[] {
    return drafts
        .filter((d) => d.name.trim().length > 0)
        .map((d, idx) => ({
            id: idx + 1,
            name: d.name.trim(),
            slug: professionNameToSlug(d.name.trim()),
            skillLevel: clampSkill(d.skillLevel, maxSkill),
            maxSkillLevel: maxSkill,
            tiers: [],
        }));
}

function clampSkill(value: number, max: number): number {
    const n = Number(value) || 0;
    if (n < 0) return 0;
    if (n > max) return max;
    return n;
}

export function EditProfessionsModal({
    isOpen, onClose, characterId, gameId, initial,
}: EditProfessionsModalProps) {
    const { games } = useGameRegistry();
    const game = games.find((g) => g.id === gameId);
    const maxSkill = getMaxProfessionSkill(game?.slug);

    const [primary, setPrimary] = useState<DraftEntry[]>(
        () => entriesToDraft(initial?.primary ?? []),
    );
    const [secondary, setSecondary] = useState<DraftEntry[]>(
        () => entriesToDraft(initial?.secondary ?? []),
    );
    const update = useUpdateCharacter();

    function handleSave() {
        const primaryEntries = draftToEntries(primary, maxSkill);
        const secondaryEntries = draftToEntries(secondary, maxSkill);
        const professions =
            primaryEntries.length === 0 && secondaryEntries.length === 0
                ? null
                : {
                    primary: primaryEntries,
                    secondary: secondaryEntries,
                    syncedAt: new Date().toISOString(),
                };
        update.mutate(
            { id: characterId, dto: { professions } },
            { onSuccess: onClose },
        );
    }

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Edit Professions">
            <div className="space-y-6">
                <p className="text-xs text-muted">
                    Skill cap for this game variant: <span className="font-mono">{maxSkill}</span>
                </p>
                <ProfessionSection
                    heading="Primary"
                    drafts={primary}
                    onChange={setPrimary}
                    maxEntries={2}
                    maxSkill={maxSkill}
                />
                <ProfessionSection
                    heading="Secondary"
                    drafts={secondary}
                    onChange={setSecondary}
                    maxEntries={5}
                    maxSkill={maxSkill}
                />
                <ModalActions
                    onCancel={onClose}
                    onSave={handleSave}
                    isPending={update.isPending}
                />
            </div>
            <datalist id="profession-name-options">
                {PROFESSION_SUGGESTIONS.map((n) => <option key={n} value={n} />)}
            </datalist>
        </Modal>
    );
}

function ProfessionSection({
    heading, drafts, onChange, maxEntries, maxSkill,
}: {
    heading: string;
    drafts: DraftEntry[];
    onChange: (next: DraftEntry[]) => void;
    maxEntries: number;
    maxSkill: number;
}) {
    return (
        <section>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted mb-2">{heading}</h3>
            <div className="space-y-2">
                {drafts.map((d, idx) => (
                    <ProfessionRowEditor key={idx} draft={d} maxSkill={maxSkill}
                        onChange={(next) => onChange(drafts.map((x, i) => i === idx ? next : x))}
                        onRemove={() => onChange(drafts.filter((_, i) => i !== idx))} />
                ))}
                {drafts.length < maxEntries && (
                    <button type="button" onClick={() => onChange([...drafts, emptyEntry()])}
                        className="text-sm text-indigo-400 hover:text-indigo-300">
                        + Add {heading.toLowerCase()}
                    </button>
                )}
            </div>
        </section>
    );
}

function ProfessionRowEditor({
    draft, onChange, onRemove, maxSkill,
}: {
    draft: DraftEntry;
    onChange: (next: DraftEntry) => void;
    onRemove: () => void;
    maxSkill: number;
}) {
    return (
        <div className="flex items-center gap-2">
            <input type="text" list="profession-name-options" value={draft.name} placeholder="Profession name"
                onChange={(e) => onChange({ ...draft, name: e.target.value })}
                className="flex-1 bg-overlay border border-edge rounded-md px-2 py-1 text-foreground" />
            <input type="number" min="0" max={maxSkill} value={draft.skillLevel} aria-label="Skill"
                onChange={(e) => onChange({ ...draft, skillLevel: Number(e.target.value) })}
                className="w-20 bg-overlay border border-edge rounded-md px-2 py-1 text-foreground" />
            <span className="text-muted">/</span>
            <span className="w-16 text-center text-muted font-mono" aria-label="Max skill">{maxSkill}</span>
            <button type="button" onClick={onRemove} aria-label="Remove profession"
                className="text-muted hover:text-red-400">✕</button>
        </div>
    );
}

function ModalActions({ onCancel, onSave, isPending }: {
    onCancel: () => void; onSave: () => void; isPending: boolean;
}) {
    return (
        <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onCancel} className="px-4 py-2 text-secondary hover:text-foreground transition-colors">Cancel</button>
            <button type="button" onClick={onSave} disabled={isPending}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-overlay disabled:text-muted text-foreground font-medium rounded-lg transition-colors">
                {isPending ? 'Saving...' : 'Save'}
            </button>
        </div>
    );
}
