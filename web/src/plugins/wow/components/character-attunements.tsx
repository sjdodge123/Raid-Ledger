/**
 * ROK-1927 (§5.3 own view, mockup F7) — the "Attunements" block inside the
 * character page Quests section: per attunement a collapsed `<details>` row
 * "Onyxia's Lair — 4 of 7 steps" + state chip, expanding to the ordered step
 * checklist (done ✓ `text-success`, the next step `font-medium text-foreground`
 * with a "Next" warning chip, the rest `text-muted`). In-progress rows start open.
 * `[]` (nothing Blizzard-confirmed for this character) → the §7 unverified sentence.
 */
import type { WowCharacterAttunementDto } from '@raid-ledger/contract';
import { StatusChip } from '../../../components/ui/status-chip';
import { ATTUNEMENT_CHIP, belowLevelNote } from '../hub-widgets/attunement-detail.helpers';
import { ATTUNEMENTS_UNVERIFIED_COPY } from '../hub-widgets/attunements.helpers';
import { attunementRowTitle, attunementStepViews, type AttunementStepView } from './character-attunements.helpers';

interface Props {
    attunements: readonly WowCharacterAttunementDto[];
    /** The character's level, for "Level 52 — needs 55"; null when unknown. */
    level: number | null;
    /** "via Armory · 9 Nov 2026" — the quests source line. */
    sourceLine: string;
}

function StepItem({ step }: { step: AttunementStepView }) {
    if (step.kind === 'done') {
        return (
            <li data-step="done" className="flex gap-2 text-success">
                <span aria-hidden="true" className="w-5 shrink-0 text-right">✓</span>
                <span>{step.label}<span className="sr-only"> (done)</span></span>
            </li>
        );
    }
    if (step.kind === 'next') {
        return (
            <li data-step="next" className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                <span aria-hidden="true" className="w-5 shrink-0 text-right">›</span>
                <span>{step.label}</span>
                <StatusChip tone="warning" title="The next step to do">Next</StatusChip>
            </li>
        );
    }
    return (
        <li data-step="rest" className="flex gap-2 text-muted">
            <span aria-hidden="true" className="w-5 shrink-0 text-right">{step.position}.</span>
            <span>{step.label}</span>
        </li>
    );
}

function AttunementRow({ attunement, level }: { attunement: WowCharacterAttunementDto; level: number | null }) {
    const chip = ATTUNEMENT_CHIP[attunement.state];
    const note = attunement.belowLevel ? belowLevelNote(level, attunement.requiredLevel) : null;
    return (
        <li data-testid="character-attunement" data-state={attunement.state}>
            <details open={attunement.state === 'in_progress' || undefined}>
                <summary className="flex min-h-[44px] cursor-pointer select-none flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                    <span className="min-w-0 flex-1">{attunementRowTitle(attunement)}</span>
                    <StatusChip tone={chip.tone} title={chip.title}>{chip.label}</StatusChip>
                </summary>
                {note !== null && <p data-testid="character-attunement-level" className="text-xs text-muted">{note}</p>}
                <ol aria-label={`${attunement.instance} steps`} className="mt-2 space-y-1 pb-2 text-sm">
                    {attunementStepViews(attunement).map((step) => <StepItem key={step.position} step={step} />)}
                </ol>
            </details>
        </li>
    );
}

/** The block; the caller renders it only when the api sent `attunements`. */
export function CharacterAttunements({ attunements, level, sourceLine }: Props) {
    return (
        <section aria-labelledby="character-attunements-heading" data-testid="character-attunements">
            <h3 id="character-attunements-heading" className="mb-2 text-lg font-semibold text-foreground">Attunements</h3>
            {attunements.length === 0 ? (
                <p className="text-sm text-muted">{ATTUNEMENTS_UNVERIFIED_COPY}</p>
            ) : (
                <>
                    <ul className="divide-y divide-edge">
                        {attunements.map((a) => <AttunementRow key={a.key} attunement={a} level={level} />)}
                    </ul>
                    <p className="mt-2 text-xs text-dim">{sourceLine}</p>
                </>
            )}
        </section>
    );
}
