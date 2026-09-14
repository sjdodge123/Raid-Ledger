/**
 * Candidate B · sheet — step 1 of the two-step flow (ROK-1555) — DEV-ONLY.
 *
 * Operator ruling 2026-09-14: the staleness prompt is NOT an inline strip
 * beside the ballot. Two different things happen on this surface, so they stay
 * two steps — "is your game time still right?" first, the ballot second. Step 1
 * never renders the week editor (the painter is unusable at 375px inside an
 * overlay); it asks one question and takes one of three answers plus a skip.
 * Argued in `docs/spikes/rok-1540-scheduling-poll-audit.md` §d.
 */
import { useState, type JSX } from 'react';

/** The two segments of the sheet's stepper. */
const SEGMENTS: readonly string[] = ['1 Game time', '2 Vote'];

/**
 * Two-segment stepper pinned to the top of the sheet. Both segments stay
 * tappable — a fresh viewer opens on step 2 and can still look back at step 1.
 */
export function Stepper({ step, onStep }: {
  step: 1 | 2;
  onStep: (s: 1 | 2) => void;
}): JSX.Element {
  return (
    <div data-testid="wf-bs-stepper" className="flex gap-1 border-b border-edge p-1.5">
      {SEGMENTS.map((label, i) => {
        const n = (i + 1) as 1 | 2;
        const active = n === step;
        return (
          <button
            key={label}
            type="button"
            aria-current={active ? 'step' : undefined}
            onClick={() => onStep(n)}
            className={`flex-1 rounded px-2 py-1 text-[11px] font-medium transition-colors ${
              active ? 'bg-overlay text-foreground' : 'text-muted hover:text-secondary'
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** Copy for the one question step 1 asks. */
function prompt(ageDays: number | null): string {
  return ageDays === null
    ? "You haven't set a game time yet. Anything to add?"
    : `Your game time is ${ageDays} days old. Anything changed?`;
}

const ANSWER_CLASS =
  'w-full rounded border border-edge bg-surface px-2 py-2 text-left text-[11px] text-foreground hover:border-emerald-500/30';

/** "I'm away some days" — reveals the date-range stub, never the week painter. */
function AbsenceAnswer(): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" data-testid="wf-bs-absence" aria-expanded={open} className={ANSWER_CLASS} onClick={() => setOpen(true)}>
        I&apos;m away some days
        <span className="block text-[10px] text-muted">Date ranges only — the existing AbsenceSection, inline.</span>
      </button>
      {open && (
        <div data-testid="wf-bs-absence-row" className="flex flex-wrap items-center gap-1.5 rounded border border-edge bg-panel/40 p-1.5">
          <span className="rounded border border-edge bg-surface px-1.5 py-1 text-[10px] text-muted">from · dd/mm</span>
          <span className="text-[10px] text-muted">→</span>
          <span className="rounded border border-edge bg-surface px-1.5 py-1 text-[10px] text-muted">to · dd/mm</span>
          <span className="ml-auto text-[10px] text-muted">stub — no real form in the wireframe</span>
        </div>
      )}
    </>
  );
}

/** "Edit my week" — a link OUT of the overlay; the painter never renders inside one. */
function EditLink(): JSX.Element {
  return (
    <a data-testid="wf-bs-edit" href="/profile/gaming/game-time" className="block px-2 py-1 text-[11px] text-emerald-300 underline">
      Edit my week →
      <span className="block text-[10px] text-muted no-underline">
        Leaves the overlay for the profile editor; the poll re-opens on step 2 on return.
      </span>
    </a>
  );
}

/**
 * Step 1 — the game-time check. `Looks right` stamps the confirmation (no
 * template write: stale means unconfirmed, not unedited) and advances;
 * `Skip` advances leaving the viewer counted as unknown in the grid.
 */
export function StepOne({ ageDays, onConfirm, onSkip }: {
  ageDays: number | null;
  onConfirm: () => void;
  onSkip: () => void;
}): JSX.Element {
  return (
    <div data-testid="wf-bs-step1" className="space-y-2">
      <p className="text-xs text-foreground">{prompt(ageDays)}</p>
      <div className="space-y-1.5">
        <button type="button" data-testid="wf-bs-confirm" className={ANSWER_CLASS} onClick={onConfirm}>
          Looks right
          <span className="block text-[10px] text-muted">
            Stamps game_time_confirmed_at — your week counts as fresh again, no edit needed.
          </span>
        </button>
        <AbsenceAnswer />
        <EditLink />
      </div>
      <button
        type="button"
        data-testid="wf-bs-skip"
        className="text-[11px] text-muted underline"
        onClick={onSkip}
      >
        Skip
      </button>
    </div>
  );
}
