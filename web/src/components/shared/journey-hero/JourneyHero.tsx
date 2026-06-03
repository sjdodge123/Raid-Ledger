import { useId, type JSX } from 'react';
import type { HeroActive, HeroTone, JourneyHeroProps, JourneyPhase } from './types';

const PHASE_TO_ACTIVE: Record<JourneyPhase, HeroActive> = {
  nominating: 0,
  voting: 1,
  decided: 2,
  scheduling: 3,
  done: 4,
};

const PHASE_LABELS = ['Nominate', 'Vote', 'Decide', 'Schedule'] as const;

const BORDER_CLS: Record<HeroTone, string> = {
  action: 'border-emerald-500/30 bg-panel/70',
  waiting: 'border-edge bg-overlay/40',
  set: 'border-amber-500/30 bg-overlay/40',
};

const BADGE_CLS: Record<HeroTone, string> = {
  action: 'text-emerald-300',
  waiting: 'text-muted',
  set: 'text-amber-300',
};

const PILL_CLS = {
  set: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  default: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
} as const;

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

function PhaseRibbon({
  active,
  hideSchedulePhase,
}: {
  active: HeroActive;
  hideSchedulePhase?: boolean;
}): JSX.Element {
  // ROK-1302: drop the trailing "Schedule" step for terminal (opted-out) lineups.
  const labels = hideSchedulePhase ? PHASE_LABELS.slice(0, 3) : PHASE_LABELS;
  return (
    <ol aria-label="Lineup progress" className="flex items-center gap-1 mb-3 list-none p-0">
      {labels.map((label, i) => {
        const state: StepState = i < active ? 'done' : i === active ? 'current' : 'future';
        const isCurrent = state === 'current';
        return (
          <li
            key={label}
            className="flex items-center flex-1"
            {...(isCurrent ? { 'aria-current': 'step' as const } : {})}
          >
            <PhaseDot state={state} label={label} />
            {i < labels.length - 1 && (
              <div className={`h-px flex-1 ${i < active ? 'bg-emerald-500/60' : 'bg-edge'}`} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function pillLabelFor(tone: HeroTone, override?: string): string | null {
  if (override !== undefined) return override;
  if (tone === 'set') return "✓ You're set";
  if (tone === 'waiting') return "✓ You're done here";
  return null;
}

function HeroHeader({ badgeId, badge, tone, pillLabel, headerAction }: { badgeId: string; badge: string; tone: HeroTone; pillLabel: string | null; headerAction?: import('react').ReactNode }): JSX.Element {
  const pillCls = tone === 'set' ? PILL_CLS.set : PILL_CLS.default;
  return (
    <div className="flex items-baseline justify-between gap-2 mb-1">
      <span id={badgeId} className={`text-[10px] uppercase tracking-wider ${BADGE_CLS[tone]}`}>{badge}</span>
      {(pillLabel || headerAction) && (
        <span className="flex items-center gap-2 flex-shrink-0">
          {pillLabel && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full border ${pillCls}`}>{pillLabel}</span>
          )}
          {headerAction}
        </span>
      )}
    </div>
  );
}

function HeroCta({ cta, onCtaClick, tone }: { cta: string; onCtaClick?: () => void; tone: HeroTone }): JSX.Element {
  const cls = tone === 'action'
    ? 'inline-block px-2 py-0.5 text-[10px] rounded bg-emerald-600 text-white disabled:opacity-50 disabled:cursor-not-allowed'
    : 'inline-block px-2 py-0.5 text-[10px] rounded border border-edge text-muted disabled:opacity-50 disabled:cursor-not-allowed';
  return (
    <div className="text-right">
      <button type="button" className={cls} onClick={onCtaClick} disabled={!onCtaClick}>{cta}</button>
    </div>
  );
}

export function JourneyHero(props: JourneyHeroProps): JSX.Element {
  const { phase, active, badge, task, sub, cta, onCtaClick, hint, tone = 'action', exitCondition, cue, donePillLabel, noRibbon, hideSchedulePhase, headerAction } = props;
  const badgeId = useId();
  const computedActive: HeroActive = active ?? PHASE_TO_ACTIVE[phase ?? 'nominating'];
  const taskCls = tone === 'action' ? 'text-foreground' : 'text-secondary';
  const pillLabel = pillLabelFor(tone, donePillLabel);
  return (
    <div role="region" aria-labelledby={badgeId} className={`border rounded-lg p-3 ${BORDER_CLS[tone]}`}>
      {!noRibbon && (
        <PhaseRibbon active={computedActive} hideSchedulePhase={hideSchedulePhase} />
      )}
      <HeroHeader badgeId={badgeId} badge={badge} tone={tone} pillLabel={pillLabel} headerAction={headerAction} />
      <div className={`text-sm font-semibold mb-1 ${taskCls}`}>{task}</div>
      {sub && <div className="text-[11px] text-muted mb-1">{sub}</div>}
      {exitCondition && <div className="text-[10px] text-amber-300/80 mb-2 italic">⏱ {exitCondition}</div>}
      {cta && <HeroCta cta={cta} onCtaClick={onCtaClick} tone={tone} />}
      {cue && <div className="text-[10px] text-emerald-300/80 mt-2">🔔 {cue}</div>}
      {hint && <div className="text-[10px] text-muted mt-2 italic">{hint}</div>}
    </div>
  );
}
