/**
 * Inline page mockups for Cycle 4 "Subtract" wireframes — DEV-ONLY.
 * Used by SimplifyWireframesPage to render BEFORE/AFTER pairs.
 */
import type { JSX, ReactNode } from 'react';

function Stripe({ children, tone = 'normal' }: { children: ReactNode; tone?: 'normal' | 'banner' | 'card' | 'accent' }): JSX.Element {
  const cls = {
    normal: 'border-edge bg-overlay/30',
    banner: 'border-emerald-500/30 bg-emerald-500/10',
    card: 'border-edge bg-panel/60',
    accent: 'border-indigo-500/30 bg-indigo-500/10',
  }[tone];
  return <div className={`border ${cls} rounded px-3 py-2 mb-2 text-xs`}>{children}</div>;
}

function Btn({ children, variant = 'ghost' }: { children: ReactNode; variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }): JSX.Element {
  const cls = {
    primary: 'bg-emerald-600 text-white',
    secondary: 'bg-panel border border-edge text-secondary',
    danger: 'bg-red-600/20 border border-red-500/40 text-red-300',
    ghost: 'border border-edge text-muted',
  }[variant];
  return <span className={`inline-block px-2 py-0.5 text-[10px] rounded ${cls}`}>{children}</span>;
}

function Tag({ children, tone = 'red' }: { children: ReactNode; tone?: 'red' | 'green' }): JSX.Element {
  const cls = tone === 'red' ? 'text-red-300' : 'text-emerald-300';
  return <div className={`text-[10px] mt-1 font-mono ${cls}`}>{children}</div>;
}

export function S1Before(): JSX.Element {
  return (
    <>
      <Stripe tone="banner"><div className="flex justify-between items-center"><span>NEXT: 1 of 114 nominated. Advance to Voting when ready.</span><Btn variant="primary">Advance to Voting</Btn></div></Stripe>
      <Stripe>
        <div className="flex items-center gap-2 mb-1">← <span className="font-semibold">L</span> <Btn variant="secondary">Nominating</Btn> <Btn variant="ghost">Edit</Btn> <Btn variant="danger">⚠ Abort</Btn></div>
        <div className="flex justify-between items-center mb-1"><span className="text-muted">Nominating → Voting → Scheduling → Archived</span><Btn variant="primary">Nominate</Btn></div>
        <div className="text-muted">Started by roknua · 3 games · 1 of 114 voters nominated · <span className="text-amber-300">111 without Steam</span></div>
        <div className="text-right text-muted">⏱ Building - 1d 23h remaining</div>
      </Stripe>
      <Stripe tone="card"><div className="flex justify-between"><span><strong>Public share link</strong> — Anyone with the link can view this lineup.</span><span><Btn variant="ghost">Copy link</Btn> ● </span></div></Stripe>
      <Stripe>Activity · 1 event ▾</Stripe>
      <Stripe tone="accent">
        <div className="flex justify-between mb-1"><strong>Nominate a Game</strong><span>3/20 nominated</span></div>
        <div className="text-muted">[search] · Min owners ▬●▬ · All genres ▼ · Players ▬●▬</div>
        <div className="mt-2 grid grid-cols-4 gap-1">{['WoW','FFXIV','Elden','Helld'].map(n => <div key={n} className="bg-overlay/40 border border-edge rounded p-1 text-center"><div className="text-[9px]">{n}</div><Btn variant="primary">+ Nominate</Btn></div>)}</div>
      </Stripe>
      <Tag>5 chrome rows · 3 "Nominate" CTAs · always-on share-card</Tag>
    </>
  );
}

export function S1After(): JSX.Element {
  return (
    <>
      <Stripe tone="card">
        <div className="flex justify-between items-center">
          <div>← <strong>Lineup — May 2026</strong> · <Btn variant="secondary">Nominating</Btn> · <span className="text-muted">1d 23h</span><div className="text-muted mt-0.5">3 games nominated by 1 voter</div></div>
          <div className="flex gap-2 items-center"><Btn variant="primary">Advance →</Btn> ⋮</div>
        </div>
      </Stripe>
      <Stripe tone="accent">
        <div className="flex justify-between mb-1"><strong>Nominate a Game</strong><span>3/20 nominated</span></div>
        <div className="text-muted">[search] <span className="ml-2"><Btn variant="ghost">Filters ▼</Btn></span></div>
        <div className="mt-2 grid grid-cols-4 gap-1">{['WoW','FFXIV','Elden','Helld'].map(n => <div key={n} className="bg-overlay/40 border border-edge rounded p-1 text-center"><div className="text-[9px]">{n}</div><Btn variant="primary">+ Nominate</Btn></div>)}</div>
      </Stripe>
      <Tag tone="green">1 chrome row · 1 "Nominate" CTA (per-tile only) · Edit/Abort/share behind ⋮</Tag>
    </>
  );
}

export function S3Before(): JSX.Element {
  return (
    <>
      <Stripe tone="banner"><div className="flex justify-between items-center"><span>NEXT: Matches ready to schedule.</span><Btn variant="primary">Open scheduling</Btn></div></Stripe>
      <Stripe>← Lineup — May 2026 <Btn variant="secondary">Scheduling</Btn> <Btn variant="ghost">Edit</Btn> <Btn variant="danger">⚠ Abort</Btn>
        <div className="text-muted">Nominating → Voting → SCHEDULING → Archived</div>
        <div className="text-amber-300">Winner: Valheim · 1 participated</div>
      </Stripe>
      <Stripe tone="card"><div className="flex justify-between"><span><strong>Public share link</strong></span><span><Btn variant="ghost">Copy link</Btn> ● <Btn variant="ghost">Share</Btn></span></div></Stripe>
      <Stripe>Activity · 1 event ▾</Stripe>
      <Stripe tone="accent">
        <div className="text-[10px] uppercase tracking-wider text-amber-300">THIS WEEK'S PODIUM</div>
        <div className="grid grid-cols-3 gap-1 mt-1 text-center">
          <div className="bg-overlay/60 border border-edge rounded p-1"><div className="text-[10px] text-gray-300">Silver</div><div className="text-[10px]">Destiny 2</div></div>
          <div className="bg-emerald-500/20 border border-emerald-500/40 rounded p-1"><div className="text-[10px] text-amber-300">Champion</div><div className="text-[10px]">Valheim</div></div>
          <div className="bg-overlay/60 border border-edge rounded p-1"><div className="text-[10px] text-orange-300">Bronze</div><div className="text-[10px]">Helldivers 2</div></div>
        </div>
        <div className="text-[10px] text-amber-300 mt-1">✓ You're in 2 matches</div>
      </Stripe>
      <Tag>Implies single winner via Champion/Silver/Bronze framing · but "2 matches" pill admits multi-match · contradiction</Tag>
    </>
  );
}

export function S3After(): JSX.Element {
  const yours = [
    { name: 'Valheim', cap: '6 of 10', sub: 'You + 5 others', color: '#4A6FA5' },
    { name: 'Helldivers 2', cap: '4 of 4', sub: 'You + 3 others · group is full', color: '#B85450' },
  ];
  const others = [
    { name: 'ARK: Survival Evolved', cap: '5 players' },
    { name: 'Phasmophobia', cap: '3 players' },
  ];
  return (
    <>
      <Stripe tone="card"><div className="flex justify-between items-center">← <strong>Lineup — May 2026</strong> <span>⋮</span></div></Stripe>
      <div className="mb-2"><div className="text-xs uppercase tracking-wider text-emerald-300 mb-1">Your matches (2)</div>
        {yours.map(m => (
          <div key={m.name} className="flex items-center gap-2 bg-overlay/40 border border-edge rounded p-2 mb-1">
            <div className="w-8 h-10 rounded text-[9px] flex items-center justify-center text-white font-semibold" style={{ background: m.color }}>{m.name.slice(0, 2)}</div>
            <div className="flex-1 text-[11px]"><div className="text-foreground">{m.name} · {m.cap}</div><div className="text-muted">{m.sub}</div></div>
            <Btn variant="primary">Pick a time →</Btn>
          </div>
        ))}
      </div>
      <div className="mb-2"><div className="text-[10px] uppercase tracking-wider text-muted mb-1">Other matches in this lineup (2)</div>
        {others.map(m => <div key={m.name} className="text-[11px] text-muted py-0.5">· {m.name} · {m.cap}</div>)}
      </div>
      <div className="text-[10px] text-muted italic">2 voters didn't match → <Btn variant="ghost">Suggest more games?</Btn></div>
      <Tag tone="green">Multi-match output as first-class · personal-first · group context preserved · single-match case degenerates to one card</Tag>
    </>
  );
}

export function S4Before(): JSX.Element {
  const rows = ['Title *  [Lineup — May 2026                  ]', 'Description  [                              ] 0/500', 'Visibility  [Public] [Private]  — Every community member can nominate.', 'Public share link ●  Anyone with the link can view.', 'Post embeds to [Use community default ▼]', 'Nomination Phase     1 day  ━━●━━━━━━━━━ 30 days', 'Voting Phase         1 day  ━━●━━━━━━━━━ 30 days', 'Match Threshold     35%    ━━━━●━━━━━━━', 'Votes per Player    3      ━●━━━━━━━━━ 10 votes', 'Tiebreaker Mode     [Bracket] [Veto] [None]'];
  return (
    <div className="bg-panel/70 border border-edge rounded p-3">
      <div className="text-sm font-semibold mb-2">Start Community Lineup ✕</div>
      {rows.map((row, i) => <div key={i} className="text-[11px] py-0.5 border-b border-edge/40 text-muted">{row}</div>)}
      <div className="text-right mt-2"><Btn variant="ghost">Cancel</Btn> <Btn variant="primary">Create Lineup</Btn></div>
      <Tag>10 visible controls</Tag>
    </div>
  );
}

export function S4After(): JSX.Element {
  return (
    <div className="bg-panel/70 border border-edge rounded p-3">
      <div className="text-sm font-semibold mb-2">Start Community Lineup ✕</div>
      <div className="text-[11px] py-1 text-muted">Title *  [Lineup — May 2026                                ]</div>
      <div className="text-[11px] py-1 text-emerald-300 mt-2">Match shape</div>
      <div className="text-[11px] py-0.5 text-muted">Preset  [Tonight] [This Week] [Series] [Custom]  <span className="text-[10px] text-muted">→ sets the 3 settings below</span></div>
      <div className="text-[11px] py-0.5 text-muted">· Match Threshold  35%  ━━━━●━━━━━━━  <span className="text-[10px]">(% of voters needed to form a match)</span></div>
      <div className="text-[11px] py-0.5 text-muted">· Votes per Player  3  ━●━━━━━━━━━ 10  <span className="text-[10px]">(how many games each picks)</span></div>
      <div className="text-[11px] py-0.5 text-muted">· Player Caps  <span className="text-emerald-400">from game metadata</span></div>
      <div className="text-[11px] py-1 text-muted mt-2">▶ <span className="text-emerald-300">More options</span> (visibility, share link, channel, phase durations, tiebreaker mode)</div>
      <div className="text-right mt-2"><Btn variant="ghost">Cancel</Btn> <Btn variant="primary">Create Lineup</Btn></div>
      <Tag tone="green">4 visible (Title + Preset + 2 sliders that drive matching). Other 6 hidden.</Tag>
    </div>
  );
}

export function S5Before(): JSX.Element {
  return (
    <>
      <div className="text-center text-[11px] text-muted mb-2"><strong>Step 1 of 3</strong> Set Gametime → Vote on Times → Suggest a Time</div>
      <div className="text-center text-sm font-semibold mb-1">When Do You Play?</div>
      <div className="text-center text-[10px] text-muted mb-2">Paint your weekly availability so the group can find the best time.</div>
      <div className="bg-overlay/40 border border-edge rounded p-2 text-[9px] text-muted">
        <div className="grid grid-cols-8 gap-px">
          <div></div>{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => <div key={d} className="text-center">{d}</div>)}
          {['8A','12P','4P','8P','11P'].map(t => <div key={t} className="contents"><div className="text-right">{t}</div>{Array(7).fill(null).map((_, i) => <div key={i} className={`h-2 ${t === '8P' || t === '11P' ? 'bg-emerald-500/40' : 'bg-overlay/60'}`}></div>)}</div>)}
        </div>
      </div>
      <div className="text-center mt-2"><Btn variant="danger">Add Absence</Btn> <Btn variant="primary">Save & Continue</Btn> <span className="text-muted text-[10px]">Skip</span></div>
      <Tag>3-step wizard · forces re-paint every lineup · paint doesn't persist to poll page (bug)</Tag>
    </>
  );
}

export function S5After(): JSX.Element {
  return (
    <>
      <div className="text-center text-[11px] text-muted mb-2"><strong>Step 1 of 2</strong> Vote on Times → Suggest a Time</div>
      <Stripe tone="card">
        <div className="text-xs">Using your saved availability from <span className="text-emerald-300 underline">profile settings</span>.</div>
        <div className="text-[10px] text-muted mt-1">Update once, applies to every lineup.</div>
      </Stripe>
      <div className="py-3 text-center text-sm">Group availability + suggest a time follow here →</div>
      <Tag tone="green">Wizard: 3 → 2 steps · availability becomes user profile (one source of truth)</Tag>
    </>
  );
}

export function S6Before(): JSX.Element {
  const rows = ['GAME & CONTENT', 'Game [ORBITALIS]', 'DETAILS', 'Event Title * [ORBITALIS Event]', 'Description [                ]', 'TIME & DURATION', 'Start [Thu May 21 2026 9:00 PM]', 'Duration [2h]', 'ROSTER', 'Player count [10]', 'Auto-promote benched ●', 'REMINDERS', '15min before ● · 1hr before ○ · 24hr before ○'];
  return (
    <>
      <div className="text-sm font-semibold mb-2">Create Event</div>
      <div className="text-[10px] text-muted mb-2">Set up a new gaming session for your community</div>
      {rows.map((row, i) => <div key={i} className={`text-[10px] py-0.5 ${row.match(/^[A-Z &]+$/) ? 'text-emerald-300 mt-2 font-semibold' : 'text-muted border-b border-edge/30'}`}>{row}</div>)}
      <div className="text-right mt-2"><span className="text-muted text-[10px] mr-2">Save as Template</span> <Btn variant="ghost">Cancel</Btn> <Btn variant="primary">Create Event</Btn></div>
      <Tag>~15 fields, all pre-filled from URL · second form for what's already decided</Tag>
    </>
  );
}

export function S6After(): JSX.Element {
  return (
    <>
      <div className="text-sm font-semibold mb-2">Confirm event</div>
      <div className="bg-overlay/40 border border-edge rounded p-3 text-sm">
        <div><strong>Valheim</strong></div>
        <div className="text-muted">Thu, May 21 · 9:00 PM EDT · 2h · 10 players</div>
      </div>
      <div className="mt-3 flex justify-end gap-2"><Btn variant="ghost">Customize…</Btn><Btn variant="primary">Create event</Btn></div>
      <Tag tone="green">2 actions (Customize escape hatch + Create). Form path retained but demoted.</Tag>
    </>
  );
}

export function S7Before(): JSX.Element {
  return (
    <>
      <Stripe tone="card"><strong>Active scheduling polls</strong> · 0RBITALIS · 0RBITALIS · 0RBITALIS · Valheim · 0RBITALIS · 0RBITALIS · 0RBITALIS</Stripe>
      <div className="flex justify-between items-center my-2"><div className="text-sm font-semibold">Upcoming Events</div><div className="flex gap-2"><Btn variant="secondary">📅 Schedule a Game</Btn> <Btn variant="primary">+ Create Event</Btn></div></div>
      <div className="text-[10px] text-muted">[tabs: Upcoming Past My Events Plans] [search] [All Games ▼] [Inside Game Time]</div>
      <Tag>2 competing primary CTAs · always-pinned polls panel even when not stale</Tag>
    </>
  );
}

export function S7After(): JSX.Element {
  return (
    <>
      <div className="flex justify-between items-center my-2"><div className="text-sm font-semibold">Upcoming Events</div><Btn variant="primary">+ New event</Btn></div>
      <div className="bg-panel/40 border border-edge rounded p-2 mt-1 text-[10px]">On click: <strong>Pick a time</strong> (game already chosen) — or — <strong>Run a poll</strong> (pick the game first)</div>
      <div className="text-[10px] text-muted mt-2">[tabs: Upcoming Past My Events Plans] [search] [Filters ▼]</div>
      <Tag tone="green">1 CTA with intent disclosed on click · polls panel only renders when user has unvoted polls</Tag>
    </>
  );
}

export function S9Before(): JSX.Element {
  return (
    <>
      <div className="text-sm font-semibold mb-2">May 2026</div>
      <div className="text-[10px] text-muted">[Prev] [Today] [Next] · [Month][Week][Day] · [search] · [Select all] [Deselect all] · [All genres ▼] · [📋 Show all 1918 games...]</div>
      <div className="grid grid-cols-7 gap-px mt-2 text-[9px]">{Array(35).fill(null).map((_, i) => <div key={i} className="bg-overlay/40 border border-edge h-8 p-0.5 text-muted">{i + 1}</div>)}</div>
      <Tag>~111 interactive elements in viewport · 6 filter controls visible default</Tag>
    </>
  );
}

export function S9After(): JSX.Element {
  return (
    <>
      <div className="text-sm font-semibold mb-2">May 2026</div>
      <div className="text-[10px] text-muted">[Prev] [Today] [Next] · [Month][Week][Day] · [search] · <Btn variant="ghost">Filter: All games</Btn></div>
      <div className="grid grid-cols-7 gap-px mt-2 text-[9px]">{Array(35).fill(null).map((_, i) => <div key={i} className="bg-overlay/40 border border-edge h-8 p-0.5 text-muted">{i + 1}</div>)}</div>
      <Tag tone="green">Filter sheet behind a single chip · default render -5 elements</Tag>
    </>
  );
}
