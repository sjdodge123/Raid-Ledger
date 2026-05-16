/**
 * U4 — Universal Submit ritual wireframes (revised) — DEV-ONLY.
 * Decided has NO submit (per-match Schedule IS the commit).
 * Each remaining phase shows a 4-state matrix: empty / partial / full-pre / post-submit.
 */
import type { JSX, ReactNode } from 'react';
// ROK-1296 (U4): the real <SubmitBar /> component replaces the inline mock.
import { SubmitBar } from '../../components/shared/submit-bar';

function PhaseBlock({ phase, children }: { phase: string; children: ReactNode }): JSX.Element {
  return (
    <div className="mb-4">
      <div className="text-[10px] uppercase tracking-wider text-emerald-300 mb-2 border-b border-emerald-500/20 pb-1">{phase}</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">{children}</div>
    </div>
  );
}

function State({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div>
      <div className="text-[10px] text-muted mb-0.5">{label}</div>
      {children}
    </div>
  );
}

function Note({ children }: { children: ReactNode }): JSX.Element {
  return <div className="text-[10px] text-muted mt-1 italic">{children}</div>;
}

export function U4SubmitRitual(): JSX.Element {
  return (
    <div>
      <PhaseBlock phase="Nominating · open-ended (no required count)">
        <State label="0 nominations">
          <SubmitBar kind="empty" status="0 nominations · add a game first" cta="Submit (disabled)" />
        </State>
        <State label="Some (n nominations) — ready to submit any time">
          <SubmitBar kind="pre" status="3 nominations · autosaved" cta="I'm done nominating →" />
        </State>
        <State label="Submitted, can still add more">
          <SubmitBar kind="post" status="Submitted Wed 8:42 PM · 12 of 20 have submitted" cta="Add more / change" />
        </State>
        <State label="Submitted + max (20)">
          <SubmitBar kind="post" status="Submitted · max 20 reached" cta="Change my picks" />
        </State>
      </PhaseBlock>
      <PhaseBlock phase="Voting · votesPerPlayer = 3 (configurable per S4)">
        <State label="0 of 3 used — must vote first">
          <SubmitBar kind="empty" status="0 of 3 votes used · vote on a game" cta="Submit (disabled)" />
        </State>
        <State label="Partial — 1 of 3 used (early-submit allowed with nudge)">
          <SubmitBar kind="partial" status="1 of 3 votes used · autosaved" cta="Submit (1 of 3) →"
            nudge="You have 2 votes left — use them or submit early." />
        </State>
        <State label="Full — 3 of 3 used (cleanest pre-submit)">
          <SubmitBar kind="pre" status="3 of 3 votes used · autosaved" cta="Submit my votes →" />
        </State>
        <State label="Submitted">
          <SubmitBar kind="post" status="Submitted Thu 7:15 PM · 14 of 20 have submitted" cta="Change my votes" />
        </State>
      </PhaseBlock>
      <PhaseBlock phase="Scheduling · per-match Lock">
        <State label="0 of N matches voted — must vote times first">
          <SubmitBar kind="empty" status="0 of 2 matches voted · pick a time first" cta="Lock (disabled)" />
        </State>
        <State label="Partial — 1 of 2 voted (early-submit allowed)">
          <SubmitBar kind="partial" status="1 of 2 matches voted · autosaved" cta="Lock 1 of 2 →"
            nudge="Still need to vote on Helldivers 2. Lock anyway and finish later, or vote on both then lock all." />
        </State>
        <State label="Full — 2 of 2 voted">
          <SubmitBar kind="pre" status="2 of 2 matches voted · autosaved" cta="Lock my times →" />
        </State>
        <State label="Submitted (locked)">
          <SubmitBar kind="post" status="Locked Sat 4:33 PM · waiting on operator + 2 others" cta="Change my times" />
        </State>
      </PhaseBlock>
      <div className="text-[10px] text-emerald-300 mt-3 font-mono">
        4 kinds: empty (disabled — do action first) · partial (allowed early with nudge) · pre (cleanest) · post (waiting + change)
      </div>
      <div className="bg-overlay/30 border border-edge rounded p-2 mt-3 text-[10px] text-muted">
        <div className="text-[11px] text-foreground font-semibold mb-1">Partial-submit semantics</div>
        Voting: submitting at 1/3 is valid — it means you had strong feelings about one game. The nudge ("use 2 more or submit early") gives the member explicit license to decide what "done" means for them. Quorum uses submitted-vs-not, not vote count.<br /><br />
        Scheduling: partial means "I voted times for some matches but not others." Locking partial commits the matches you DID vote on; the rest stay in autosave for later.
      </div>
    </div>
  );
}

export function U4SubmitBefore(): JSX.Element {
  return (
    <div className="space-y-2">
      <div className="bg-overlay/40 border border-edge rounded p-2 text-[11px]">
        <div className="text-muted">[Vote toggle clicked] ✓ Voted · 2 of 3 votes used</div>
        <Note>Autosaved silently. No explicit "done" moment. User re-opens later wondering "did that count? am I supposed to do something else?"</Note>
      </div>
      <div className="bg-overlay/40 border border-edge rounded p-2 text-[11px]">
        <div className="text-muted">[Nomination added] 3 of 20 nominated</div>
        <Note>Same problem — no ritual, no confirmation, ambient anxiety.</Note>
      </div>
      <div className="bg-overlay/40 border border-edge rounded p-2 text-[11px]">
        <div className="text-muted">Decided page renders ··· "You're in 2 matches"</div>
        <Note>No clear "what now?" — member sees the matches but doesn't know if they're expected to do anything else, or if the system is waiting on them. Today's UI has a redundant "Commit" step before scheduling — but matches were already implicitly chosen by voting.</Note>
      </div>
      <div className="bg-overlay/40 border border-edge rounded p-2 text-[11px]">
        <div className="text-muted">Operator sees: "voters nominated: 3" (counts autosave-touches)</div>
        <Note>Operator can't distinguish "definitely done" from "started but didn't finish" — bad quorum signal.</Note>
      </div>
      <div className="text-[10px] text-red-300 mt-2 font-mono">
        No close-the-loop affordance · ambient "did that count?" anxiety · operator quorum uses autosaves not commitments · ceremonial Decided-commit duplicates Vote
      </div>
    </div>
  );
}
