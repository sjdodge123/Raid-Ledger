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
import {
    getProfessionOptions,
    getMaxEntriesForCategory,
    type ProfessionCategory,
} from '../lib/profession-categories';

interface EditProfessionsModalProps {
    isOpen: boolean;
    onClose: () => void;
    characterId: string;
    gameId: number;
    initial: CharacterProfessionsDto | null;
}

/**
 * Skill level is held as a string while editing so the user can fully
 * clear the field — number-typed controlled inputs can't be backspaced
 * past 0 because empty input would round-trip through `Number('')` → 0
 * and re-render as "0", trapping a leading zero.
 */
interface DraftEntry {
    name: string;
    skillLevel: string;
}

function emptyEntry(): DraftEntry {
    return { name: '', skillLevel: '' };
}

function entriesToDraft(entries: ProfessionEntryDto[]): DraftEntry[] {
    return entries.map((e) => ({
        name: e.name,
        skillLevel: e.skillLevel === 0 ? '' : String(e.skillLevel),
    }));
}

function clampSkill(value: string, max: number): number {
    const n = Number.parseInt(value, 10);
    if (Number.isNaN(n) || n < 0) return 0;
    if (n > max) return max;
    return n;
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

export function EditProfessionsModal({
    isOpen, onClose, characterId, gameId, initial,
}: EditProfessionsModalProps) {
    const { games } = useGameRegistry();
    const game = games.find((g) => g.id === gameId);
    const gameSlug = game?.slug ?? null;
    const maxSkill = getMaxProfessionSkill(gameSlug);

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
                    category="primary"
                    drafts={primary}
                    onChange={setPrimary}
                    maxEntries={getMaxEntriesForCategory('primary', gameSlug)}
                    maxSkill={maxSkill}
                    gameSlug={gameSlug}
                    siblingNames={primary.map((d) => d.name)}
                />
                <ProfessionSection
                    heading="Secondary"
                    category="secondary"
                    drafts={secondary}
                    onChange={setSecondary}
                    maxEntries={getMaxEntriesForCategory('secondary', gameSlug)}
                    maxSkill={maxSkill}
                    gameSlug={gameSlug}
                    siblingNames={secondary.map((d) => d.name)}
                />
                <ModalActions
                    onCancel={onClose}
                    onSave={handleSave}
                    isPending={update.isPending}
                />
            </div>
        </Modal>
    );
}

function ProfessionSection({
    heading, category, drafts, onChange, maxEntries, maxSkill, gameSlug, siblingNames,
}: {
    heading: string;
    category: ProfessionCategory;
    drafts: DraftEntry[];
    onChange: (next: DraftEntry[]) => void;
    maxEntries: number;
    maxSkill: number;
    gameSlug: string | null;
    siblingNames: string[];
}) {
    const allOptions = getProfessionOptions(category, gameSlug);
    return (
        <section>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted mb-2">{heading}</h3>
            <div className="space-y-2">
                {drafts.map((d, idx) => (
                    <ProfessionRowEditor
                        key={idx}
                        draft={d}
                        maxSkill={maxSkill}
                        availableOptions={availableFor(allOptions, siblingNames, d.name)}
                        onChange={(next) => onChange(drafts.map((x, i) => i === idx ? next : x))}
                        onRemove={() => onChange(drafts.filter((_, i) => i !== idx))}
                    />
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

/** Hide options already chosen by sibling rows so the user can't pick the same profession twice. */
function availableFor(
    all: readonly string[],
    siblingNames: string[],
    selfName: string,
): readonly string[] {
    const taken = new Set(siblingNames.filter((n) => n && n !== selfName));
    return all.filter((opt) => !taken.has(opt));
}

function ProfessionRowEditor({
    draft, onChange, onRemove, maxSkill, availableOptions,
}: {
    draft: DraftEntry;
    onChange: (next: DraftEntry) => void;
    onRemove: () => void;
    maxSkill: number;
    availableOptions: readonly string[];
}) {
    return (
        <div className="flex items-center gap-2">
            <select value={draft.name}
                onChange={(e) => onChange({ ...draft, name: e.target.value })}
                aria-label="Profession"
                className="flex-1 bg-overlay border border-edge rounded-md px-2 py-1 text-foreground">
                <option value="">Select profession…</option>
                {availableOptions.map((name) => (
                    <option key={name} value={name}>{name}</option>
                ))}
            </select>
            <input type="number" inputMode="numeric" min="0" max={maxSkill} value={draft.skillLevel}
                aria-label="Skill" placeholder="0"
                onChange={(e) => onChange({ ...draft, skillLevel: e.target.value })}
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
