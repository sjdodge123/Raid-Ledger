import { useState } from 'react';
import type {
    CharacterProfessionsDto,
    ProfessionEntryDto,
} from '@raid-ledger/contract';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { Modal } from '../../../components/ui/modal';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { useUpdateCharacter } from '../../../hooks/use-character-mutations';
import { useDirtyCloseGuard } from '../../../hooks/use-dirty-close-guard';
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

function buildProfessionsPayload(
    primary: DraftEntry[],
    secondary: DraftEntry[],
    maxSkill: number,
): CharacterProfessionsDto | null {
    const primaryEntries = draftToEntries(primary, maxSkill);
    const secondaryEntries = draftToEntries(secondary, maxSkill);
    if (primaryEntries.length === 0 && secondaryEntries.length === 0) return null;
    return {
        primary: primaryEntries,
        secondary: secondaryEntries,
        syncedAt: new Date().toISOString(),
    };
}

function sameDrafts(a: DraftEntry[], b: DraftEntry[]): boolean {
    return a.length === b.length
        && a.every((d, i) => d.name === b[i].name && d.skillLevel === b[i].skillLevel);
}

/**
 * The drafts start from `baseline`, captured once at mount (the panel mounts
 * this modal only while editing, so every open starts fresh). `isDirty` is a
 * structural compare against it, and drives the ROK-1655 dirty-close guard.
 */
function useEditProfessionsState(
    gameId: number,
    initial: CharacterProfessionsDto | null,
) {
    const { games } = useGameRegistry();
    const gameSlug = games.find((g) => g.id === gameId)?.slug ?? null;
    const maxSkill = getMaxProfessionSkill(gameSlug);
    const [baseline] = useState(() => ({
        primary: entriesToDraft(initial?.primary ?? []),
        secondary: entriesToDraft(initial?.secondary ?? []),
    }));
    const [primary, setPrimary] = useState<DraftEntry[]>(baseline.primary);
    const [secondary, setSecondary] = useState<DraftEntry[]>(baseline.secondary);
    const isDirty = !sameDrafts(primary, baseline.primary) || !sameDrafts(secondary, baseline.secondary);
    return { gameSlug, maxSkill, primary, setPrimary, secondary, setSecondary, isDirty };
}

/** Save closes through the plain `onClose` (never the guard), so it never prompts. */
function useSaveProfessions(
    characterId: string,
    s: ReturnType<typeof useEditProfessionsState>,
    onClose: () => void,
) {
    const update = useUpdateCharacter();
    const run = () => update.mutate(
        { id: characterId, dto: { professions: buildProfessionsPayload(s.primary, s.secondary, s.maxSkill) } },
        { onSuccess: onClose },
    );
    return { run, isPending: update.isPending };
}

export function EditProfessionsModal({
    isOpen, onClose, characterId, gameId, initial,
}: EditProfessionsModalProps) {
    const s = useEditProfessionsState(gameId, initial);
    const save = useSaveProfessions(characterId, s, onClose);
    // Escape, the backdrop, × and Cancel ask first on a dirty form; Save's
    // onSuccess closes through the plain onClose, so a Save never prompts.
    const guard = useDirtyCloseGuard(s.isDirty, onClose);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Edit Professions" closeGuard={guard}
            footer={<ModalActions onCancel={guard.requestClose} onSave={save.run} isPending={save.isPending} />}>
            <div className="space-y-6">
                <p className="text-xs text-muted">
                    Skill cap for this game variant: <span className="font-mono">{s.maxSkill}</span>
                </p>
                <ProfessionSection heading="Primary" category="primary"
                    drafts={s.primary} onChange={s.setPrimary}
                    maxEntries={getMaxEntriesForCategory('primary', s.gameSlug)}
                    maxSkill={s.maxSkill} gameSlug={s.gameSlug}
                    siblingNames={s.primary.map((d) => d.name)} />
                <ProfessionSection heading="Secondary" category="secondary"
                    drafts={s.secondary} onChange={s.setSecondary}
                    maxEntries={getMaxEntriesForCategory('secondary', s.gameSlug)}
                    maxSkill={s.maxSkill} gameSlug={s.gameSlug}
                    siblingNames={s.secondary.map((d) => d.name)} />
            </div>
        </Modal>
    );
}

interface ProfessionSectionProps {
    heading: string;
    category: ProfessionCategory;
    drafts: DraftEntry[];
    onChange: (next: DraftEntry[]) => void;
    maxEntries: number;
    maxSkill: number;
    gameSlug: string | null;
    siblingNames: string[];
}

function ProfessionSection({
    heading, category, drafts, onChange, maxEntries, maxSkill, gameSlug, siblingNames,
}: ProfessionSectionProps) {
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
                    <Button variant="ghost" size="sm" onClick={() => onChange([...drafts, emptyEntry()])}>
                        + Add {heading.toLowerCase()}
                    </Button>
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

interface ProfessionRowEditorProps {
    draft: DraftEntry;
    onChange: (next: DraftEntry) => void;
    onRemove: () => void;
    maxSkill: number;
    availableOptions: readonly string[];
}

function ProfessionRowEditor({
    draft, onChange, onRemove, maxSkill, availableOptions,
}: ProfessionRowEditorProps) {
    return (
        <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
                <Select aria-label="Profession" placeholder="Select profession…" value={draft.name}
                    onChange={(e) => onChange({ ...draft, name: e.target.value })}>
                    {availableOptions.map((name) => (
                        <option key={name} value={name}>{name}</option>
                    ))}
                </Select>
            </div>
            <div className="w-20 shrink-0">
                <Input type="number" inputMode="numeric" min={0} max={maxSkill} value={draft.skillLevel}
                    aria-label="Skill" placeholder="0"
                    onChange={(e) => onChange({ ...draft, skillLevel: e.target.value })} />
            </div>
            <span className="text-muted">/</span>
            <span className="shrink-0 min-w-[3ch] text-center text-muted font-mono" aria-label="Max skill">{maxSkill}</span>
            <Button variant="ghost" iconOnly onClick={onRemove}
                aria-label={draft.name ? `Remove ${draft.name}` : 'Remove profession'}>
                <XMarkIcon aria-hidden="true" className="w-5 h-5" />
            </Button>
        </div>
    );
}

function ModalActions({ onCancel, onSave, isPending }: {
    onCancel: () => void; onSave: () => void; isPending: boolean;
}) {
    // The Modal footer (OVERLAY_FOOTER_CLASS) already lays these out right-aligned.
    return (
        <>
            <Button variant="secondary" onClick={onCancel}>Cancel</Button>
            <Button onClick={onSave} loading={isPending} loadingLabel="Saving…">Save</Button>
        </>
    );
}
