import { useId, type JSX, type ReactNode } from 'react';
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

const META_CLS = 'text-[10px] uppercase tracking-wider';

/**
 * ROK-1584 (H1-b): the dot ribbon is replaced by a 4px bar plus a
 * "Nominate · Vote · Decide · Schedule" line with a right-aligned step count.
 * The `<ol aria-label="Lineup progress">` semantics (and `aria-current="step"`)
 * are deliberately kept — they are the canonical phase indicator for the
 * lineup smoke specs and assistive tech.
 */
function PhaseProgress({
  active,
  tone,
  hideSchedulePhase,
}: {
  active: HeroActive;
  tone: HeroTone;
  hideSchedulePhase?: boolean;
}): JSX.Element {
  // ROK-1302: drop the trailing "Schedule" step for terminal (opted-out) lineups.
  const labels = hideSchedulePhase ? PHASE_LABELS.slice(0, 3) : PHASE_LABELS;
  const step = Math.min(active + 1, labels.length);
  const fillCls = tone === 'action' ? 'bg-emerald-500' : 'bg-edge-strong';
  return (
    <div className="mt-2 mb-1">
      <div className="h-1 rounded-full bg-edge-subtle overflow-hidden">
        <div
          data-testid="journey-progress-fill"
          className={`h-full rounded-full ${fillCls}`}
          style={{ width: `${(step / labels.length) * 100}%` }}
        />
      </div>
      <div className="flex items-center justify-between gap-2 mt-1.5">
        <PhaseLine labels={labels} active={active} />
        <span className={`flex-none text-dim ${META_CLS}`}>{`step ${step} of ${labels.length}`}</span>
      </div>
    </div>
  );
}

function PhaseLine({ labels, active }: { labels: readonly string[]; active: HeroActive }): JSX.Element {
  return (
    <ol
      data-testid="journey-progress"
      data-active={active}
      aria-label="Lineup progress"
      className={`flex flex-wrap items-center gap-1 list-none p-0 m-0 min-w-0 ${META_CLS}`}
    >
      {labels.map((label, i) => (
        <PhaseStep key={label} label={label} isCurrent={i === active} showSeparator={i > 0} />
      ))}
    </ol>
  );
}

function PhaseStep({
  label,
  isCurrent,
  showSeparator,
}: {
  label: string;
  isCurrent: boolean;
  showSeparator: boolean;
}): JSX.Element {
  return (
    <li
      className={`flex items-center gap-1 ${isCurrent ? 'font-semibold text-foreground' : 'text-dim'}`}
      {...(isCurrent ? { 'aria-current': 'step' as const } : {})}
    >
      {showSeparator && <span aria-hidden="true" className="text-dim">·</span>}
      {label}
    </li>
  );
}

function pillLabelFor(tone: HeroTone, override?: string): string | null {
  if (override !== undefined) return override;
  if (tone === 'set') return "✓ You're set";
  if (tone === 'waiting') return "✓ You're done here";
  return null;
}

/**
 * The headline row: the task copy (prefixed by a 20px ✓ disc once the viewer's
 * part is done) on the left, the `action` chip pinned to the right.
 */
function HeroHeadline({
  task,
  sub,
  taskCls,
  doneLabel,
  action,
}: {
  task: string;
  sub?: ReactNode;
  taskCls: string;
  doneLabel: string | null;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div data-testid="journey-headline-row" className="flex items-start gap-2">
      <div className="flex-1 min-w-0">
        <div className={`flex items-center gap-2 text-sm font-semibold ${taskCls}`}>
          {doneLabel && <DoneCheck label={doneLabel} />}
          <span className="min-w-0">{task}</span>
        </div>
        {sub && <div className="text-[11px] text-muted mt-1">{sub}</div>}
      </div>
      {action && <div className="flex-none">{action}</div>}
    </div>
  );
}

/** The 20px green ✓ disc; the old done-pill copy lives on as its a11y label. */
function DoneCheck({ label }: { label: string }): JSX.Element {
  return (
    <>
      <span
        data-testid="journey-done-check"
        aria-hidden="true"
        className="flex-none w-5 h-5 rounded-full bg-emerald-500 text-white grid place-items-center text-[12px] leading-none"
      >
        ✓
      </span>
      <span className="sr-only">{label}</span>
    </>
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

/** The unchanged exit-condition / CTA / cue / hint lines, in their shipped order. */
function HeroLines({
  tone, cta, onCtaClick, exitCondition, cue, hint,
}: Pick<JourneyHeroProps, 'cta' | 'onCtaClick' | 'exitCondition' | 'cue' | 'hint'> & { tone: HeroTone }): JSX.Element {
  return (
    <>
      {exitCondition && <div className="text-[10px] text-amber-300/80 mb-2 italic">⏱ {exitCondition}</div>}
      {cta && <HeroCta cta={cta} onCtaClick={onCtaClick} tone={tone} />}
      {cue && <div className="text-[10px] text-emerald-300/80 mt-2">🔔 {cue}</div>}
      {hint && <div className="text-[10px] text-muted mt-2 italic">{hint}</div>}
    </>
  );
}

/**
 * The phase hero (ROK-1294, relaid out for H1-b in ROK-1584).
 *
 * Top to bottom: badge line → headline row (✓ disc + task, `action` chip on the
 * right) → `headerAction` cluster → progress bar + phase line → cta / exit /
 * cue / hint → the full-width `manage` slot.
 */
export function JourneyHero(props: JourneyHeroProps): JSX.Element {
  const { phase, active, badge, task, sub, cta, onCtaClick, hint, tone = 'action', exitCondition, cue, donePillLabel, noRibbon, hideSchedulePhase, headerAction, headerActionBlock, action, manage } = props;
  const badgeId = useId();
  const computedActive: HeroActive = active ?? PHASE_TO_ACTIVE[phase ?? 'nominating'];
  const taskCls = tone === 'action' ? 'text-foreground' : 'text-secondary';
  // ROK-1582: `headerActionBlock` hands the cluster the full card width on a
  // phone, so a row of 44px actions gets full size instead of being squeezed.
  const clusterCls = `ml-auto flex flex-wrap items-center justify-end gap-2 min-w-0 mt-2${headerActionBlock ? ' w-full sm:w-auto' : ''}`;
  return (
    <div role="region" aria-labelledby={badgeId} className={`border rounded-lg p-3 ${BORDER_CLS[tone]}`}>
      {/* ROK-1500: the badge row still wraps — a long "started by…" badge must
          never hang past the card edge on a phone. */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <span id={badgeId} className={`${META_CLS} ${BADGE_CLS[tone]}`}>{badge}</span>
      </div>
      <HeroHeadline task={task} sub={sub} taskCls={taskCls} action={action}
        doneLabel={pillLabelFor(tone, donePillLabel)} />
      {headerAction && <div className={clusterCls}>{headerAction}</div>}
      {!noRibbon && (
        <PhaseProgress active={computedActive} tone={tone} hideSchedulePhase={hideSchedulePhase} />
      )}
      <HeroLines tone={tone} cta={cta} onCtaClick={onCtaClick}
        exitCondition={exitCondition} cue={cue} hint={hint} />
      {manage && <div data-testid="journey-manage" className="w-full mt-3">{manage}</div>}
    </div>
  );
}
