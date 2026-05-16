/**
 * Cycle 4 "Unify" simplification wireframes — DEMO_MODE-gated.
 * Foundation (U1 + U2), composited page-level designs (S1/Sv/S3/Ss),
 * and isolated subtractions (S4/S5/S6/S7/S9).
 */
import type { JSX, ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useSystemStatus } from '../../hooks/use-system-status';
import {
  S1Before, S3Before, S4Before, S4After,
  S5Before, S5After, S6Before, S6After, S7Before, S7After,
  S9Before, S9After,
} from './simplify-mocks';
import { U1JourneyHero, U2GameResearch, U3DoneStates, NoFurtherActionBefore } from './simplify-unify-mocks';
import { S1Composite, SvComposite, S3Composite, SsComposite, StandaloneSsComposite } from './simplify-composite-mocks';
import { U4SubmitRitual, U4SubmitBefore } from './simplify-submit-mocks';

function useDemoMode(): { ready: boolean; allowed: boolean } {
  const { data, isLoading } = useSystemStatus();
  if (isLoading) return { ready: false, allowed: false };
  return { ready: true, allowed: data?.demoMode === true };
}

function Section({ id, title, delta, why, children }: {
  id: string; title: string; delta: string; why: string; children: ReactNode;
}): JSX.Element {
  return (
    <section id={id} className="mb-12 scroll-mt-4">
      <div className="border-b border-edge pb-2 mb-4">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="text-sm text-emerald-300 font-mono">{delta}</p>
        <p className="text-xs text-secondary mt-1">{why}</p>
      </div>
      {children}
    </section>
  );
}

function BA({ before, after }: { before: ReactNode; after: ReactNode }): JSX.Element {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div>
        <div className="text-xs uppercase tracking-wider text-red-400 mb-2">BEFORE — today</div>
        <div className="bg-panel/50 border border-red-500/20 rounded-lg p-3">{before}</div>
      </div>
      <div>
        <div className="text-xs uppercase tracking-wider text-emerald-400 mb-2">AFTER — proposed</div>
        <div className="bg-panel/50 border border-emerald-500/30 rounded-lg p-3">{after}</div>
      </div>
    </div>
  );
}

function U1BannerSoup(): JSX.Element {
  const banners = [
    { copy: 'NEXT: 1 of 114 nominated. Advance to Voting when ready.', cta: 'Advance to Voting' },
    { copy: 'NEXT: Cast your votes for up to 3 games.', cta: 'Open voting' },
    { copy: 'NEXT: You voted for 2 games. Sit tight — 113 of 114 still voting.', cta: 'Advance to Decided' },
    { copy: 'NEXT: Valheim matched. Open scheduling to lock a time.', cta: 'Open scheduling' },
  ];
  return (
    <div className="space-y-2">
      {banners.map((b, i) => (
        <div key={i} className="border border-emerald-500/20 bg-emerald-500/5 rounded p-2 text-[11px]">
          <div className="flex justify-between items-center"><span className="text-muted">{b.copy}</span><span className="inline-block px-2 py-0.5 text-[10px] rounded bg-emerald-600 text-white">{b.cta}</span></div>
        </div>
      ))}
      <div className="text-[10px] text-red-300 mt-1 font-mono">Same job · 4 different shapes · "advance" vs "open" vs "sit tight" · no phase context across pages</div>
    </div>
  );
}

function U2InertRefs(): JSX.Element {
  return (
    <div>
      <div className="text-[11px] text-muted mb-2">Today: game references are inert. To learn about an unfamiliar game during voting, the user must leave the page.</div>
      {[
        { n: 'Valheim', c: '#4A6FA5', s: '18 own · 1–10 players' },
        { n: 'Helldivers 2', c: '#B85450', s: '16 own · 1–4 players' },
        { n: 'Some Indie Game You\'ve Never Heard Of', c: '#888', s: '2 own · 1–4 players' },
      ].map((g) => (
        <div key={g.n} className="flex items-center gap-2 bg-overlay/40 border border-edge rounded p-2 mb-1">
          <div className="w-8 h-10 rounded text-[9px] flex items-center justify-center text-white font-semibold" style={{ background: g.c }}>{g.n.slice(0, 2)}</div>
          <div className="flex-1 text-[11px]"><div className="text-foreground truncate">{g.n}</div><div className="text-muted truncate">{g.s}</div></div>
          <span className="inline-block px-2 py-0.5 text-[10px] rounded bg-emerald-600 text-white">Vote</span>
        </div>
      ))}
      <div className="text-[10px] text-red-300 mt-2 font-mono">User votes blind on games they don't recognize · no in-page research path</div>
    </div>
  );
}

const SECTIONS: Array<{ id: string; title: string; delta: string; why: string; before: JSX.Element; after: JSX.Element }> = [
  {
    id: 'u1', title: 'U1 — Through-line: one Journey Hero across all phases',
    delta: '4 inconsistent banners → 1 morphing component',
    why: 'Every phase today has its own banner copy, CTA wording, and chrome shape — "advance" vs "open" vs "sit tight." Replace with one persistent component that morphs across all 4 phases + done state. The user always knows step + task + deadline + action. Every composite page (S1, Sv, S3, Ss, S6) renders this at the top.',
    before: <U1BannerSoup />, after: <U1JourneyHero />,
  },
  {
    id: 'u2', title: 'U2 — Game research everywhere a game is referenced',
    delta: 'inert refs → universal drawer · context-aware CTA',
    why: 'Members are asked to nominate, vote, and pick times for games they may have never played. Tapping any game name / thumbnail / mention opens a drawer with description, screenshots, ownership, and a source-aware action (Nominate / Vote / View game page). Drawer never navigates away.',
    before: <U2InertRefs />, after: <U2GameResearch />,
  },
  {
    id: 'u3', title: 'U3 — State taxonomy: action / waiting / set',
    delta: '3 explicit tones · exit condition on every waiting state · multi-match scheduling sub-states · Decided is never "done"',
    why: 'JourneyHero gains a `tone` prop with 3 states. (A) Action — bright emerald, primary CTA (default; Decided ALWAYS lives here for members; Scheduling mid-state too — partial isn\'t done). (B) Waiting — soft border, "✓ You\'re done here" pill, ghost CTA, plus a concrete exit condition (auto-advance threshold or deadline) AND a notification cue ("we\'ll DM you when…"). (C) Set — amber celebratory, "✓ You\'re set" pill, event preview, future-reminder cue. Fixes the prior round\'s confusions: Decided was wrongly labeled done, and "1 of 2 scheduled" was wrongly treated as done.',
    before: <NoFurtherActionBefore />, after: <U3DoneStates />,
  },
  {
    id: 'u4', title: 'U4 — Universal Submit ritual',
    delta: '4 SubmitBar kinds (empty / partial / pre / post) · per-phase state matrix · Decided has no Submit',
    why: 'Autosave protects data; Submit declares "I\'m done deciding." Submit triggers the U3 waiting tone — quorum counts use submitted, not autosaved. Four kinds: empty (disabled — do action first), partial (early-submit allowed with nudge), full pre-submit (cleanest), post-submit (waiting + change). DECIDED has NO page-level Submit — the per-match Schedule CTA on each match card IS the commit; a separate Decided Submit would be ceremonial duplication of the vote.',
    before: <U4SubmitBefore />, after: <U4SubmitRitual />,
  },
  {
    id: 's1', title: 'S1 — Nominating page (composite + Common Ground hero treatment)',
    delta: 'Common Ground promoted to featured tier · 4 big tiles with "why" reasons · plain search demoted',
    why: 'The "tailored picks" from the Common Ground recommender deserve hero treatment, not a hidden filter row. Featured section above the regular grid: 4 bigger tiles, each with the WHY annotation ("12 of you own this," "matches your taste cluster," "trending in your guild"), plus a Regenerate affordance. The plain search/grid below becomes the "or search any game" fallback at smaller visual weight. Tabs (All / Yours / Trending) sit above showing existing nominations.',
    before: <S1Before />, after: <S1Composite />,
  },
  {
    id: 'sv', title: 'Sv — Voting page (composite — NEW; never wireframed before)',
    delta: 'no canonical voting page → composite with U1 + U2 + normalized vote bars',
    why: 'Today\'s voting UI is a leaderboard with vote buttons that have no accessible name and vote bars that max out at 100% with 1 vote. Composite: U1 hero at top, per-row game refs (U2 drawer on tap), vote bars normalized to voter count (X/12 voters), focused checkmark-circle for voted state. Tapping anywhere except the vote toggle opens the research drawer — vote stays on the row.',
    before: <U1BannerSoup />, after: <SvComposite />,
  },
  {
    id: 's3', title: 'S3 — Decided page (composite — multi-match)',
    delta: 'podium illusion → multi-match list · U1 + U2 integrated',
    why: 'Lineup output is parallel match clusters, not 1st/2nd/3rd. 20 voters with a 4-player game cap = up to 5 matches. Composite: U1 Decided morph at top, Your matches (personal-first), Other matches in this lineup (group context), leftover-voters CTA. Each game ref triggers U2. Single-match case is a degenerate (one card).',
    before: <S3Before />, after: <S3Composite />,
  },
  {
    id: 'ss', title: 'Ss — Scheduling Poll page (composite — from a lineup match)',
    delta: '3-step wizard → 1 unified page · availability from profile · inline "Lock this time" → S6',
    why: 'Today: scheduling a match means leaving the lineup, painting weekly availability (which doesn\'t persist anyway — known bug), then landing on a separate scheduling-poll page with different chrome. Composite: U1 Scheduling morph (knows which match you\'re on), game ref banner (U2 drawer), group availability heatmap auto-populated from profile (per S5), suggested times list with inline Vote / Lock CTAs. Locking jumps to the S6 confirm card.',
    before: <S5Before />, after: <SsComposite />,
  },
  {
    id: 'sx', title: 'Sx — Standalone scheduling poll (from "Schedule a Game" button)',
    delta: 'reuse Ss layout · noRibbon Journey Hero · single-game framing · zero loop chrome',
    why: 'The "Schedule a Game" button skips Nominate / Vote / Decide entirely — operator already knows the game, just needs a time. So the 4-phase ribbon doesn\'t apply; instead the Journey Hero uses noRibbon mode with a "🗓 Scheduling Poll · started by you" badge. Rest of the page (game ref, group availability, suggested times, Lock CTA) is identical to Ss. One implementation, two entry points: from-lineup-match (Ss) and standalone (Sx).',
    before: <S5Before />, after: <StandaloneSsComposite />,
  },
  {
    id: 's4', title: 'S4 — Start Lineup modal (match-shape settings stay visible)',
    delta: '10 controls → 4 (Title + 3 match-shape settings + Create)',
    why: 'Match Threshold + Votes per Player + Player Caps determine how the lineup clusters voters into matches — hiding them surprises the operator at Decided. Keep visible (ideally via a "Tonight / This Week / Series" preset chooser per ROK-1265). Other 6 controls move behind "More options."',
    before: <S4Before />, after: <S4After />,
  },
  {
    id: 's5', title: 'S5 — Availability becomes a profile setting (principle)',
    delta: '3-step wizard → 2-step · single source of truth · fixes paint-doesn\'t-persist bug',
    why: 'Weekly availability is a property of the USER, not the lineup. Today we ask every time and the paint doesn\'t persist to the poll page (real bug observed in the walk). Move to /settings/availability, ask once, reuse across every lineup. The Ss composite above shows this principle in action.',
    before: <S5Before />, after: <S5After />,
  },
  {
    id: 's6', title: 'S6 — Create Event: full form → confirm card',
    delta: '~15 fields → 2 actions (Confirm + Customize)',
    why: 'By the time we hit /events/new the URL has gameId, startTime, matchId pre-filled. The form is busywork. Default to confirm-card with a "Customize…" escape hatch. The card embeds a U2 trigger so the operator can double-check the game.',
    before: <S6Before />, after: <S6After />,
  },
  {
    id: 's7', title: 'S7 — /events: unified entry CTA',
    delta: '2 competing CTAs → 1 "New event" with intent disclosure',
    why: '"Schedule a Game" creates scheduling-only polls. "Create Event" creates events. Same primary visual weight, different outcomes, confusing names. One button, two clearly-named choices on click.',
    before: <S7Before />, after: <S7After />,
  },
  {
    id: 's9', title: 'S9 — /calendar: filter chip collapse',
    delta: '6 filter controls visible → 1 "Filter" chip (sheet)',
    why: 'The 1918-games-with-select-all chrome dwarfs the actual calendar grid. Move to a sheet behind a single chip — default render is the calendar itself.',
    before: <S9Before />, after: <S9After />,
  },
];

export function SimplifyWireframesPage(): JSX.Element | null {
  const { ready, allowed } = useDemoMode();
  if (!ready) return null;
  if (!allowed) return <Navigate to="/" replace />;
  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <header className="border-b border-edge pb-3 mb-6">
        <h1 className="text-xl font-semibold text-foreground">Cycle 4 — "Unify the lineup loop"</h1>
        <p className="text-sm text-secondary mt-1">
          Through-line + universal game-research drawer + composited page designs. U1/U2/U3/U4 = foundation. S1/Sv/S3/Ss/Sx = composited pages (foundation rendered in context). S4/S5/S6/S7/S9 = isolated subtractions.
        </p>
        <p className="text-xs text-amber-300 mt-1">
          📄 Canonical design doc: <code className="text-amber-200">planning-artifacts/specs/cycle-4-unify-lineup.md</code> · Cycle plan: <code className="text-amber-200">planning-artifacts/next-sprint.md</code> · Memory pointer: <code className="text-amber-200">reference_cycle_4_unify_design.md</code>
        </p>
        <nav className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {SECTIONS.map(({ id, title }) => (
            <a key={id} href={`#${id}`} className="text-emerald-300 hover:text-emerald-200 underline">{title.split(' — ')[0]}</a>
          ))}
        </nav>
      </header>
      {SECTIONS.map((s) => (
        <Section key={s.id} id={s.id} title={s.title} delta={s.delta} why={s.why}>
          <BA before={s.before} after={s.after} />
        </Section>
      ))}
    </div>
  );
}
