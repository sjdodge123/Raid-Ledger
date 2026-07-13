/**
 * Composited Cycle 4 page wireframes — DEV-ONLY.
 * Show the full page layout with U1 Journey Hero rendered at top
 * and U2 game-research drawer affordances on every game reference.
 */
import type { JSX, ReactNode } from 'react';
import { JourneyHero } from '../../components/shared/journey-hero';

function Btn({ children, variant = 'ghost' }: { children: ReactNode; variant?: 'primary' | 'secondary' | 'ghost' }): JSX.Element {
  const cls = {
    primary: 'bg-emerald-600 text-white',
    secondary: 'bg-panel border border-edge text-secondary',
    ghost: 'border border-edge text-muted',
  }[variant];
  return <span className={`inline-block px-2 py-0.5 text-[10px] rounded ${cls}`}>{children}</span>;
}

function GameRef({ name, color, sub, action, avatars }: {
  name: string; color: string; sub: string; action?: string; avatars?: number;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2 bg-overlay/40 border border-edge rounded p-2 mb-1 group hover:border-emerald-500/30">
      <div className="w-8 h-10 rounded text-[9px] flex items-center justify-center text-white font-semibold flex-shrink-0" style={{ background: color }}>{name.slice(0, 2)}</div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] text-foreground truncate">
          {name} <span className="text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity">ⓘ</span>
        </div>
        <div className="text-[10px] text-muted truncate">{sub}</div>
      </div>
      {avatars && <div className="flex -space-x-1">{Array(Math.min(avatars, 3)).fill(null).map((_, i) => <div key={i} className="w-4 h-4 rounded-full bg-overlay border border-edge text-[8px] flex items-center justify-center text-muted">{i + 1}</div>)}{avatars > 3 && <span className="text-[9px] text-muted ml-1">+{avatars - 3}</span>}</div>}
      {action && <Btn variant="primary">{action}</Btn>}
    </div>
  );
}

function Tag({ children }: { children: ReactNode }): JSX.Element {
  return <div className="text-[10px] mt-2 font-mono text-emerald-300">{children}</div>;
}

function VoteBar({ pct }: { pct: number }): JSX.Element {
  return (
    <div className="flex-1 h-1.5 bg-overlay/60 rounded-full overflow-hidden">
      <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
    </div>
  );
}

function CommonGroundTile({ name, color, reason, big = true }: { name: string; color: string; reason: string; big?: boolean }): JSX.Element {
  return (
    <div className="bg-overlay/40 border border-emerald-500/20 rounded p-2 hover:border-emerald-500/50 group cursor-pointer">
      <div className={`${big ? 'aspect-[3/2]' : 'aspect-[4/3]'} rounded mb-1 flex items-center justify-center text-white font-bold ${big ? 'text-base' : 'text-[10px]'}`} style={{ background: `linear-gradient(135deg, ${color}, ${color}aa)` }}>{name.slice(0, 2).toUpperCase()}</div>
      <div className={`${big ? 'text-[11px]' : 'text-[9px]'} text-foreground truncate font-medium`}>{name} <span className="text-emerald-400 opacity-0 group-hover:opacity-100">ⓘ</span></div>
      <div className="text-[9px] text-emerald-300 mb-1">★ {reason}</div>
      <Btn variant="primary">+ Nominate</Btn>
    </div>
  );
}

function CommonGroundRow({ label, tiles }: { label: string; tiles: Array<{ name: string; color: string; reason: string }> }): JSX.Element {
  return (
    <div className="mb-3">
      <div className="text-[10px] uppercase tracking-wider text-secondary mb-1">{label}</div>
      <div className="grid grid-cols-4 gap-2">
        {tiles.map((t) => <CommonGroundTile key={t.name} {...t} />)}
      </div>
    </div>
  );
}

type SubmitKind = 'empty' | 'partial' | 'pre' | 'post';
export function SubmitBar({ status, cta, kind = 'pre', nudge }: { status: string; cta: string; kind?: SubmitKind; nudge?: string }): JSX.Element {
  const wrapCls = {
    empty: 'border-edge bg-overlay/20 opacity-60',
    partial: 'border-emerald-500/25 bg-emerald-500/5',
    pre: 'border-emerald-500/40 bg-emerald-500/5',
    post: 'border-edge bg-overlay/30',
  }[kind];
  const ctaVariant: 'primary' | 'ghost' = kind === 'pre' || kind === 'partial' ? 'primary' : 'ghost';
  const prefix = kind === 'post' ? '✓ ' : kind === 'empty' ? '⊘ ' : '';
  return (
    <div className={`mt-2 border ${wrapCls} rounded p-2`}>
      <div className="flex justify-between items-center">
        <div className="text-[11px] text-secondary">{prefix}{status}</div>
        <Btn variant={ctaVariant}>{cta}</Btn>
      </div>
      {nudge && <div className="text-[10px] text-muted italic mt-1">{nudge}</div>}
    </div>
  );
}

export function S1Composite(): JSX.Element {
  const owned = [
    { name: 'Valheim', color: '#4A6FA5', reason: '12 of you own this' },
    { name: 'Destiny 2', color: '#5B7553', reason: '18 own · Free' },
    { name: 'Deep Rock Galactic', color: '#A07030', reason: '9 of you own · 60% off' },
    { name: 'Risk of Rain 2', color: '#506480', reason: '7 of you own · co-op' },
  ];
  const taste = [
    { name: 'Helldivers 2', color: '#B85450', reason: 'Matches your sci-fi/co-op cluster' },
    { name: 'Phasmophobia', color: '#9F4A4A', reason: 'Matches horror/co-op cluster' },
    { name: 'Lethal Company', color: '#558058', reason: 'Matches party/horror cluster' },
    { name: 'Sea of Thieves', color: '#357090', reason: 'Matches adventure/co-op cluster' },
  ];
  const trending = [
    { name: 'Palworld', color: '#7B5DB0', reason: 'Trending in your guild · new' },
    { name: 'Elden Ring Nightreign', color: '#705030', reason: 'Wishlisted by 6 · launches soon' },
    { name: 'ARK: Survival', color: '#406050', reason: 'On sale 70% off · 14 own' },
    { name: 'Monster Hunter Wilds', color: '#8B6030', reason: 'Trending · 8 wishlisted' },
  ];
  return (
    <>
      <JourneyHero active={0} badge="Step 1 of 4 · Nominating · 2d left"
        task="Add games to the running."
        sub="3 of 20 nominated by 1 voter."
        cta="" hint="Tip: tap any game to see details before nominating." />
      <div className="mt-3 flex gap-2 border-b border-edge text-[11px]">
        <span className="border-b-2 border-emerald-400 pb-1 px-1 text-emerald-300">All (3)</span>
        <span className="text-muted pb-1 px-1">Yours (3)</span>
        <span className="text-muted pb-1 px-1">Trending</span>
      </div>
      <div className="mt-2 mb-4">
        <GameRef name="Valheim" color="#4A6FA5" sub="18 own · 1–10 players · Survival" avatars={1} />
        <GameRef name="Helldivers 2" color="#B85450" sub="16 own · 1–4 players · Co-op shooter" avatars={1} />
        <GameRef name="Destiny 2" color="#5B7553" sub="18 own · 1–6 players · FPS" avatars={1} />
      </div>
      <div className="border-t border-edge pt-3">
        <div className="flex justify-between items-center mb-2">
          <div className="text-[11px] font-semibold text-emerald-300">✨ Common Ground — picked for your group</div>
          <div className="flex gap-1"><Btn variant="ghost">↻ Regenerate</Btn><Btn variant="ghost">Why these?</Btn></div>
        </div>
        <div className="text-[10px] text-muted mb-3">Based on what your guild owns, plays, and wishlists. Tap any tile to research before nominating.</div>
        <CommonGroundRow label="Owned by your group" tiles={owned} />
        <CommonGroundRow label="Matches your taste" tiles={taste} />
        <CommonGroundRow label="Trending or on sale" tiles={trending} />
      </div>
      <div className="border-t border-edge pt-3 mt-3">
        <div className="flex justify-between items-center mb-2">
          <div className="text-[11px] text-muted">Or search any game</div>
          <Btn variant="ghost">Filters ▼</Btn>
        </div>
        <div className="text-[10px] text-muted mb-1">[search games…]</div>
      </div>
      <SubmitBar kind="pre" status="You've nominated 3 · autosaved" cta="I'm done nominating →" />
      <Tag>Common Ground = 3 themed rows × 4 = 12 tiles · "Why these?" affordance · plain search demoted · SubmitBar at bottom for ritual completion</Tag>
    </>
  );
}

export function StandaloneSsComposite(): JSX.Element {
  return (
    <>
      <JourneyHero active={0} tone="action" noRibbon
        badge="🗓 Scheduling Poll · started by you"
        task="Pick a time for Helldivers 2."
        sub="5 people in this poll · 1 of 5 have voted on times so far."
        exitCondition="Auto-locks at deadline Sat 11:59 PM (3d), or when you click Lock."
        cta=""
        hint="No nominate/vote phase — game is pre-chosen. Skip the loop, just pick a time." />
      <div className="mt-3">
        <GameRef name="Helldivers 2" color="#B85450" sub="You + 5 members · 1–4 players (group exceeds cap — operator note)" />
      </div>
      <div className="mt-2 border-t border-edge pt-2">
        <div className="text-[11px] font-semibold mb-1">Group availability — this week</div>
        <div className="grid grid-cols-8 gap-px text-[9px] text-muted bg-overlay/30 p-1 rounded">
          <div></div>{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => <div key={d} className="text-center">{d}</div>)}
          {['6P','7P','8P','9P','10P'].map(t => <div key={t} className="contents"><div className="text-right">{t}</div>{Array(7).fill(null).map((_, i) => <div key={i} className={`h-2 ${t === '9P' && (i === 4 || i === 5) ? 'bg-emerald-500/70' : t === '8P' || t === '9P' ? 'bg-emerald-500/30' : 'bg-overlay/50'}`}></div>)}</div>)}
        </div>
        <div className="text-[10px] text-muted italic mt-1">Auto-populated from invited members' profile availability.</div>
      </div>
      <div className="mt-2 border-t border-edge pt-2">
        <div className="text-[11px] font-semibold mb-1">Suggested times</div>
        <div className="bg-overlay/40 border border-emerald-500/40 rounded p-2 mb-1 flex justify-between items-center text-[11px]">
          <span>Thu May 21 · 9:00 PM <span className="text-muted">· 1 vote (you)</span></span>
          <div className="flex gap-1"><Btn variant="ghost">+ Vote</Btn> <Btn variant="primary">Lock this time →</Btn></div>
        </div>
        <div className="text-[10px] text-muted mt-1">Suggest another → [datetime input] [Suggest]</div>
      </div>
      <SubmitBar kind="pre" status="You voted Thu 9 PM · autosaved" cta="Lock this time →" />
      <Tag>noRibbon Journey Hero · single-match framing · operator framing · SubmitBar at bottom for ritual lock</Tag>
    </>
  );
}

export function SvComposite(): JSX.Element {
  const games = [
    { name: 'Valheim', color: '#4A6FA5', sub: '18 own · 1–10 players', votes: 8, max: 12, voted: true },
    { name: 'Destiny 2', color: '#5B7553', sub: '18 own · 1–6 players', votes: 6, max: 12, voted: true },
    { name: 'Helldivers 2', color: '#B85450', sub: '16 own · 1–4 players', votes: 5, max: 12, voted: false },
    { name: 'Some Indie Game', color: '#888', sub: '2 own · 1–4 players', votes: 2, max: 12, voted: false },
  ];
  return (
    <>
      <JourneyHero active={1} badge="Step 2 of 4 · Voting · 1d 2h left"
        task="Pick the games you want to play."
        sub="You've voted on 2 of 3. 12 of 20 voters have weighed in."
        cta="" hint="Tip: tap any game to see details before voting." />
      <div className="mt-3">
        {games.map((g) => (
          <div key={g.name} className={`flex items-center gap-2 bg-overlay/40 border ${g.voted ? 'border-emerald-500/40' : 'border-edge'} rounded p-2 mb-1 group hover:border-emerald-500/60`}>
            <div className="w-8 h-10 rounded text-[9px] flex items-center justify-center text-white font-semibold flex-shrink-0" style={{ background: g.color }}>{g.name.slice(0, 2)}</div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] text-foreground flex items-center gap-1">
                {g.name} <span className="text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity">ⓘ</span>
              </div>
              <div className="text-[10px] text-muted">{g.sub}</div>
              <div className="flex items-center gap-2 mt-1"><VoteBar pct={(g.votes / g.max) * 100} /><span className="text-[9px] text-muted">{g.votes}/{g.max}</span></div>
            </div>
            <div className={`w-5 h-5 rounded-full border-2 ${g.voted ? 'bg-emerald-500 border-emerald-400 text-white' : 'border-edge'} flex items-center justify-center text-[9px]`}>{g.voted ? '✓' : ''}</div>
          </div>
        ))}
      </div>
      <div className="text-[10px] text-muted italic mt-2">Tapping anywhere on the row except the vote circle opens the U2 drawer — vote stays on the row.</div>
      <SubmitBar kind="pre" status="3 of 3 votes used · autosaved on each tap" cta="Submit my votes →" />
      <Tag>U1 hero · vote bars normalized to voter count · per-row U2 trigger · SubmitBar ritualizes "I'm done deciding" — quorum count uses Submitted not Autosaved</Tag>
    </>
  );
}

export function S3Composite(): JSX.Element {
  return (
    <>
      <JourneyHero active={2} badge="Step 3 of 4 · Decided"
        task="We matched 18 of 20 voters into 4 games."
        sub="You're in 2 matches: Valheim (6 players) and Helldivers 2 (4 players, full)."
        cta="" hint="Tap any game to learn more before scheduling." />
      <div className="mt-3 mb-2">
        <div className="text-[10px] uppercase tracking-wider text-emerald-300 mb-1">Your matches (2)</div>
        <GameRef name="Valheim" color="#4A6FA5" sub="6 of 10 · You + 5 others" action="Pick a time →" />
        <GameRef name="Helldivers 2" color="#B85450" sub="4 of 4 · You + 3 others · group is full" action="Pick a time →" />
      </div>
      <div className="mb-2">
        <div className="text-[10px] uppercase tracking-wider text-muted mb-1">Other matches in this lineup (2)</div>
        <GameRef name="ARK: Survival Evolved" color="#5B7553" sub="5 players" />
        <GameRef name="Phasmophobia" color="#9F4A4A" sub="3 players" />
      </div>
      <div className="text-[10px] text-muted italic">2 voters didn't match → <Btn variant="ghost">Suggest more games?</Btn></div>
      <Tag>U1 hero · personal-first match cards · group context preserved · per-match Schedule CTA IS the commit (no page-level Submit)</Tag>
    </>
  );
}

export function SsComposite(): JSX.Element {
  return (
    <>
      <JourneyHero active={3} badge="Step 4 of 4 · Scheduling · 22h left"
        task="Schedule Valheim (Match 1 of 2)."
        sub="Group availability is using your saved availability from profile."
        cta="" hint="Next: Helldivers 2. Tap Valheim to learn more." />
      <div className="mt-3">
        <GameRef name="Valheim" color="#4A6FA5" sub="Match: You + 5 others" />
      </div>
      <div className="mt-2 border-t border-edge pt-2">
        <div className="text-[11px] font-semibold mb-1">Group availability — this week</div>
        <div className="grid grid-cols-8 gap-px text-[9px] text-muted bg-overlay/30 p-1 rounded">
          <div></div>{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => <div key={d} className="text-center">{d}</div>)}
          {['6P','7P','8P','9P','10P'].map(t => <div key={t} className="contents"><div className="text-right">{t}</div>{Array(7).fill(null).map((_, i) => <div key={i} className={`h-2 ${t === '9P' && (i === 4 || i === 5) ? 'bg-emerald-500/70' : t === '8P' || t === '9P' ? 'bg-emerald-500/30' : 'bg-overlay/50'}`}></div>)}</div>)}
        </div>
        <div className="text-[10px] text-muted italic mt-1">Bright cells = popular times for this match's 6 players. (Your availability auto-applied per S5.)</div>
      </div>
      <div className="mt-2 border-t border-edge pt-2">
        <div className="text-[11px] font-semibold mb-1">Suggested times</div>
        <div className="bg-overlay/40 border border-emerald-500/40 rounded p-2 mb-1 flex justify-between items-center text-[11px]">
          <span>Thu May 21 · 9:00 PM <span className="text-muted">· 4 votes</span></span>
          <div className="flex gap-1"><Btn variant="secondary">✓ You voted</Btn> <Btn variant="primary">Lock this time →</Btn></div>
        </div>
        <div className="bg-overlay/40 border border-edge rounded p-2 mb-1 flex justify-between items-center text-[11px]">
          <span>Fri May 22 · 9:00 PM <span className="text-muted">· 2 votes</span></span>
          <Btn variant="ghost">Vote</Btn>
        </div>
        <div className="text-[10px] text-muted mt-1">Suggest another → [datetime input] [Suggest]</div>
      </div>
      <SubmitBar kind="pre" status="You voted Thu 9 PM · autosaved" cta="Lock my times for both matches →" />
      <Tag>U1 hero · no Step 1 (S5 — availability from profile) · inline Lock per row OR SubmitBar for "lock all my matches" ritual</Tag>
    </>
  );
}
