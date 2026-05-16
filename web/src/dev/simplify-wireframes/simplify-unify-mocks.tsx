/**
 * Cycle 4 Unify wireframes — Through-line ("Journey Hero") and Game-research drawer.
 * DEV-ONLY. Static mocks; no behavior wired up.
 */
import type { JSX, ReactNode } from 'react';

function Btn({ children, variant = 'ghost' }: { children: ReactNode; variant?: 'primary' | 'secondary' | 'ghost' }): JSX.Element {
  const cls = {
    primary: 'bg-emerald-600 text-white',
    secondary: 'bg-panel border border-edge text-secondary',
    ghost: 'border border-edge text-muted',
  }[variant];
  return <span className={`inline-block px-2 py-0.5 text-[10px] rounded ${cls}`}>{children}</span>;
}

type StepState = 'done' | 'current' | 'future';
function PhaseDot({ state, label }: { state: StepState; label: string }): JSX.Element {
  const dotCls = {
    done: 'bg-emerald-500/80 text-white',
    current: 'bg-emerald-400 ring-2 ring-emerald-300/50 text-white',
    future: 'bg-overlay/40 text-dim border border-edge',
  }[state];
  const symbol = state === 'done' ? '✓' : state === 'current' ? '●' : '○';
  return (
    <div className="flex flex-col items-center min-w-0 flex-1">
      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] ${dotCls}`}>{symbol}</div>
      <div className="text-[9px] text-muted mt-1 truncate">{label}</div>
    </div>
  );
}

function PhaseRibbon({ active }: { active: 0 | 1 | 2 | 3 | 4 }): JSX.Element {
  const phases = ['Nominate', 'Vote', 'Decide', 'Schedule'];
  return (
    <div className="flex items-center gap-1 mb-3">
      {phases.map((label, i) => {
        const state: StepState = i < active ? 'done' : i === active ? 'current' : 'future';
        return (
          <div key={label} className="flex items-center flex-1">
            <PhaseDot state={state} label={label} />
            {i < phases.length - 1 && <div className={`h-px flex-1 ${i < active ? 'bg-emerald-500/60' : 'bg-edge'}`} />}
          </div>
        );
      })}
    </div>
  );
}

type HeroTone = 'action' | 'waiting' | 'set';
export function JourneyHero({ active, badge, task, sub, cta, hint, tone = 'action', exitCondition, cue, donePillLabel, noRibbon }: {
  active: 0 | 1 | 2 | 3 | 4; badge: string; task: string; sub?: string; cta?: string; hint?: string;
  tone?: HeroTone; exitCondition?: string; cue?: string; donePillLabel?: string; noRibbon?: boolean;
}): JSX.Element {
  const borderCls = {
    action: 'border-emerald-500/30 bg-panel/70',
    waiting: 'border-edge bg-overlay/40',
    set: 'border-amber-500/30 bg-overlay/40',
  }[tone];
  const badgeCls = { action: 'text-emerald-300', waiting: 'text-muted', set: 'text-amber-300' }[tone];
  const taskCls = tone === 'action' ? 'text-foreground' : 'text-secondary';
  const pillLabel = donePillLabel ?? (tone === 'set' ? "✓ You're set" : tone === 'waiting' ? "✓ You're done here" : null);
  const pillCls = tone === 'set'
    ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
    : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  return (
    <div className={`border rounded-lg p-3 ${borderCls}`}>
      {!noRibbon && <PhaseRibbon active={active} />}
      <div className="flex items-baseline justify-between mb-1">
        <span className={`text-[10px] uppercase tracking-wider ${badgeCls}`}>{badge}</span>
        {pillLabel && <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full border ${pillCls}`}>{pillLabel}</span>}
      </div>
      <div className={`text-sm font-semibold mb-1 ${taskCls}`}>{task}</div>
      {sub && <div className="text-[11px] text-muted mb-1">{sub}</div>}
      {exitCondition && <div className="text-[10px] text-amber-300/80 mb-2 italic">⏱ {exitCondition}</div>}
      {cta && <div className="text-right">{tone === 'action' ? <Btn variant="primary">{cta}</Btn> : <span className="inline-block px-2 py-0.5 text-[10px] rounded border border-edge text-muted">{cta}</span>}</div>}
      {cue && <div className="text-[10px] text-emerald-300/80 mt-2">🔔 {cue}</div>}
      {hint && <div className="text-[10px] text-muted mt-2 italic">{hint}</div>}
    </div>
  );
}

function StateGroup({ label, kicker, children }: { label: string; kicker: string; children: ReactNode }): JSX.Element {
  return (
    <div className="mb-4">
      <div className="text-[10px] uppercase tracking-wider text-emerald-300 mb-1">{label}</div>
      <div className="text-[10px] text-muted mb-2">{kicker}</div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

export function U3DoneStates(): JSX.Element {
  return (
    <div>
      <StateGroup label="State A — Action required" kicker="Bright primary CTA. Decided is ALWAYS in this state (member must still schedule). Scheduling mid-state too — partial isn't done.">
        <JourneyHero active={2} tone="action" badge="Step 3 of 4 · Decided · 22h to schedule"
          task="Schedule your matches."
          sub="You're in 2: Valheim (6 players) and Helldivers 2 (4, full)."
          cta="Open your matches →"
          hint="Note: this is NEVER a 'done' state for the member — schedule is always required." />
        <JourneyHero active={3} tone="action" badge="Step 4 of 4 · Scheduling · 1 of 2 done"
          task="You voted Thu 9 PM for Valheim."
          sub="Still need to vote on times for Helldivers 2."
          cta="Open Helldivers 2 →"
          hint="Mid-state. Progress indicator (1 of 2) — not 'done'. Treated as action-required until both matches have your vote." />
      </StateGroup>
      <StateGroup label="State B — Done with this phase, group still working" kicker="Soft border, ✓ pill, ghost CTA. Every waiting line names the concrete trigger (auto-advance threshold or deadline). Notification cue closes the loop.">
        <JourneyHero active={0} tone="waiting" badge="Step 1 of 4 · Nominating"
          task="You've nominated 3 games."
          sub="3 of 20 voters have nominated so far."
          exitCondition="Auto-advances when 15 of 20 voters have nominated, or at deadline Wed 11:59 PM (2d 3h)."
          cta="Edit your nominations"
          cue="We'll DM you when voting opens." />
        <JourneyHero active={1} tone="waiting" badge="Step 2 of 4 · Voting"
          task="You voted on 3 of 3 games."
          sub="12 of 20 have voted so far."
          exitCondition="Auto-advances when 15 of 20 have voted, or at deadline Thu 11:59 PM (1d 2h)."
          cta="Change your votes"
          cue="We'll DM you when matches are decided." />
        <JourneyHero active={3} tone="waiting" badge="Step 4 of 4 · Scheduling · 2 of 2 voted"
          task="You voted on times for both matches."
          sub="Valheim: 4 of 6 have voted on times. Helldivers 2: 3 of 4 have voted."
          exitCondition="Each match locks at 75% agreement, or at deadline Sat 6 PM (3d)."
          cta="Review your votes"
          cue="We'll DM you when events are locked." />
      </StateGroup>
      <StateGroup label="State C — All set, see you on the day" kicker="Amber celebratory border, '✓ You're set' pill, event preview embedded. The whole-loop done state — only renders when every match the user is in has a locked time.">
        <JourneyHero active={4} tone="set" badge="Done 🎉"
          task="Events scheduled."
          sub="Valheim · Thu May 21 · 9 PM EDT · You + 5 others. Helldivers 2 · Sat May 23 · 8 PM EDT · You + 3 others."
          cta="Manage signups"
          cue="We'll DM you 24h, 1h, and 15min before each event." />
      </StateGroup>
      <div className="text-[10px] text-emerald-300 font-mono">
        3 explicit tones (action/waiting/set) · exit condition on every waiting state · multi-match scheduling has both action (partial) and waiting (all-voted) variants · Decided is never "done"
      </div>
    </div>
  );
}

function NoFurtherActionBefore(): JSX.Element {
  return (
    <div className="space-y-2">
      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded p-2 text-[11px]">
        <div className="flex justify-between items-center">
          <span className="text-muted">NEXT: 1 of 114 nominated. Advance to Voting when ready.</span>
          <span className="inline-block px-2 py-0.5 text-[10px] rounded bg-emerald-600 text-white">Advance to Voting</span>
        </div>
        <div className="text-[10px] text-amber-300 mt-1">→ User has nominated 3 games. CTA still loudly green. No "done" indicator. User keeps wondering "did that count?"</div>
      </div>
      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded p-2 text-[11px]">
        <div className="flex justify-between items-center">
          <span className="text-muted">NEXT: You voted for 2 games. Sit tight — 113 of 114 still voting.</span>
          <span className="inline-block px-2 py-0.5 text-[10px] rounded bg-emerald-600 text-white">Advance to Decided</span>
        </div>
        <div className="text-[10px] text-amber-300 mt-1">→ "Sit tight" is a hint but the CTA right next to it says "Advance" (operator-only). Member can't tell if they should still do something.</div>
      </div>
      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded p-2 text-[11px]">
        <div className="flex justify-between items-center">
          <span className="text-muted">✓ Voted · 2 of 3 votes used</span>
          <span className="inline-block px-2 py-0.5 text-[10px] rounded bg-panel border border-edge text-muted">— no clear "done"</span>
        </div>
        <div className="text-[10px] text-amber-300 mt-1">→ "2 of 3 used" leaves it ambiguous: have I done enough, or should I find a 3rd?</div>
      </div>
      <div className="text-[10px] text-red-300 mt-1 font-mono">No phase-aware "you're done" affirmation · members re-open the page to check · operators get extra "is the system stuck?" pings</div>
    </div>
  );
}

export { NoFurtherActionBefore };

export function U1JourneyHero(): JSX.Element {
  return (
    <div className="space-y-3">
      <JourneyHero active={0} badge="Step 1 of 4 · Nominating · 2d left"
        task="Add games to the running."
        sub="3 of 20 nominated by 1 voter."
        cta="Add a game →"
        hint="Tip: tap any game to see details before nominating." />
      <JourneyHero active={1} badge="Step 2 of 4 · Voting · 1d 2h left"
        task="Pick the games you want to play."
        sub="You've voted on 2 of 3."
        cta="Continue voting →"
        hint="Tip: tap any game name to see details before voting." />
      <JourneyHero active={2} badge="Step 3 of 4 · Decided"
        task="We matched 18 of 20 voters into 4 games."
        sub="You're in 2 matches: Valheim (6 players) and Helldivers 2 (4 players, full)."
        cta="Open your matches →"
        hint="Tap any game to learn more before scheduling." />
      <JourneyHero active={3} badge="Step 4 of 4 · Scheduling · 22h left"
        task="Schedule your matches: 1 of 2 done."
        sub="Next: Helldivers 2 — group availability shows Thu 9 PM is popular."
        cta="Vote on times →" />
      <JourneyHero active={4} tone="set" badge="Done 🎉"
        task="Event scheduled."
        sub="Valheim · Thursday May 21 · 9:00 PM EDT · 10 players"
        cta="View event details" />
      <div className="text-[10px] text-emerald-300 mt-1 font-mono">
        One component · five morphs · always: step + task + countdown + action. See U3 below for tone variants (action/waiting/set).
      </div>
    </div>
  );
}

function GameRefRow({ name, color, sub }: { name: string; color: string; sub: string }): JSX.Element {
  return (
    <div className="flex items-center gap-2 bg-overlay/40 border border-edge rounded p-2 mb-1 cursor-pointer hover:border-emerald-500/40 group">
      <div className="w-8 h-10 rounded flex items-center justify-center text-[9px] font-semibold text-white" style={{ background: color }}>{name.slice(0, 2)}</div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-foreground truncate group-hover:underline">{name} <span className="text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity">ⓘ</span></div>
        <div className="text-[10px] text-muted truncate">{sub}</div>
      </div>
      <Btn variant="primary">+ Nominate</Btn>
    </div>
  );
}

function ResearchDrawer({ context, cta }: { context: string; cta: string }): JSX.Element {
  return (
    <div className="bg-panel border border-emerald-500/40 rounded-lg shadow-lg overflow-hidden">
      <div className="bg-overlay/60 px-3 py-1.5 text-[10px] text-emerald-300 flex justify-between"><span>From {context}</span><span className="text-muted">Esc / tap outside to close</span></div>
      <div className="aspect-[3/1] bg-gradient-to-br from-indigo-600 via-purple-500 to-pink-500 flex items-center justify-center text-white font-bold text-lg">VALHEIM</div>
      <div className="p-3 space-y-2">
        <div className="text-sm font-semibold text-foreground">Valheim</div>
        <div className="text-[10px] text-muted">A brutal exploration and survival game for 1–10 players, set in a vibrant procedural world inspired by Norse mythology.</div>
        <div className="flex flex-wrap gap-1 text-[10px]">
          <Btn variant="secondary">Survival</Btn>
          <Btn variant="secondary">1–10 players</Btn>
          <Btn variant="secondary">18 own in guild</Btn>
          <Btn variant="secondary">-50% · $9.99</Btn>
        </div>
        <div className="grid grid-cols-3 gap-1">
          <div className="aspect-video bg-overlay/60 rounded text-[9px] text-muted flex items-center justify-center">screenshot</div>
          <div className="aspect-video bg-overlay/60 rounded text-[9px] text-muted flex items-center justify-center">screenshot</div>
          <div className="aspect-video bg-overlay/60 rounded text-[9px] text-muted flex items-center justify-center">screenshot</div>
        </div>
        <div className="flex justify-between items-center pt-1">
          <div className="flex gap-1 text-[10px]"><Btn variant="ghost">View on Steam ↗</Btn><Btn variant="ghost">Game page →</Btn></div>
          <Btn variant="primary">{cta}</Btn>
        </div>
      </div>
    </div>
  );
}

export function U2GameResearch(): JSX.Element {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted mb-1">Trigger surface — Nominate grid (or any game reference)</div>
        <div>
          <GameRefRow name="Valheim" color="#4A6FA5" sub="18 own · 1–10 players · -50% $9.99" />
          <GameRefRow name="Helldivers 2" color="#B85450" sub="16 own · 1–4 players" />
          <GameRefRow name="Destiny 2" color="#5B7553" sub="18 own · 1–6 players · Free" />
          <div className="text-[10px] text-muted italic mt-2">Hovering / tapping a row reveals an ⓘ affordance. The "+ Nominate" button on the right stays available for users who already know the game.</div>
        </div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted mb-1">Opened state — Game-research drawer</div>
        <ResearchDrawer context="Nominate grid" cta="+ Nominate this" />
        <div className="text-[10px] text-emerald-300 mt-3 font-mono">
          Same drawer triggered from any game reference; context-aware CTA per source:
        </div>
        <ul className="text-[10px] text-muted mt-1 space-y-0.5">
          <li>· <strong>Nominate grid</strong> → "+ Nominate this"</li>
          <li>· <strong>Voting list</strong> → "Vote for this"</li>
          <li>· <strong>Decided podium</strong> → "View full game page →"</li>
          <li>· <strong>Scheduling card / Event detail</strong> → "View full game page →"</li>
          <li>· <strong>Body copy mention of a game name</strong> → "View full game page →"</li>
        </ul>
        <div className="text-[10px] text-muted italic mt-2">Drawer closes on Esc / outside-click. Nominate / vote action does NOT navigate away; user returns to the list with the action committed.</div>
      </div>
    </div>
  );
}
