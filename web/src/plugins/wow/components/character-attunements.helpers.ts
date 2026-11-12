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

/** Done steps, then the first open one marked next (none once attuned or without data), then the rest. */
export function attunementStepViews(attunement: WowCharacterAttunementDto): AttunementStepView[] {
    const hasNext = attunement.nextStep !== null && attunement.state !== 'done' && attunement.state !== 'no_data';
    let nextTaken = !hasNext;
    return attunement.steps.map((step, i) => {
        if (step.done) return { label: step.label, kind: 'done', position: i + 1 };
        const kind: AttunementStepKind = nextTaken ? 'rest' : 'next';
        nextTaken = true;
        return { label: step.label, kind, position: i + 1 };
    });
}
