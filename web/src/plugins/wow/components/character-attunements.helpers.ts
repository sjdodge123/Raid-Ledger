/**
 * ROK-1927 (§5.3 own view, mockup F7) — pure helpers for the Attunements block
 * on the character page Quests section: the collapsed row's text and the
 * checklist's per-step kind (done / next / remaining).
 */
import type { WowCharacterAttunementDto } from '@raid-ledger/contract';

export type AttunementStepKind = 'done' | 'next' | 'rest';

export interface AttunementStepView {
    label: string;
    kind: AttunementStepKind;
    /** 1-based position in the chain. */
    position: number;
}

/** "Onyxia's Lair — 4 of 7 steps". */
export function attunementRowTitle(attunement: WowCharacterAttunementDto): string {
    const done = attunement.steps.filter((s) => s.done).length;
    return `${attunement.instance} — ${done} of ${attunement.steps.length} steps`;
}

/**
 * The index of the "Next" step: the open step whose label is the api's `nextStep`
 * (on a log-only import that is the furthest step in the quest log, which may sit
 * past earlier open steps — `loggedStep`, api `attunement-evaluate.ts`). Falls back
 * to the first open step when `nextStep` is null or matches no open step; -1 once
 * attuned or without data.
 */
function nextStepIndex(attunement: WowCharacterAttunementDto): number {
    if (attunement.state === 'done' || attunement.state === 'no_data') return -1;
    const named = attunement.nextStep === null
        ? -1
        : attunement.steps.findIndex((s) => !s.done && s.label === attunement.nextStep);
    return named >= 0 ? named : attunement.steps.findIndex((s) => !s.done);
}

/** Done steps, the api's next step marked next (none once attuned or without data), every other open step muted. */
export function attunementStepViews(attunement: WowCharacterAttunementDto): AttunementStepView[] {
    const nextIdx = nextStepIndex(attunement);
    return attunement.steps.map((step, i) => {
        const kind: AttunementStepKind = step.done ? 'done' : i === nextIdx ? 'next' : 'rest';
        return { label: step.label, kind, position: i + 1 };
    });
}
