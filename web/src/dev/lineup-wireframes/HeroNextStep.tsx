/**
 * Hero "Your next step" banner — visually dominant element on every wireframe.
 * Mobile: sticky-to-top, fades to compact on scroll-down.
 * Desktop (≥md): in-flow, no fade.
 * DEV-ONLY (ROK-1193 wireframes).
 */
import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';

export type HeroTone = 'action' | 'waiting' | 'aborted' | 'privacy';

interface HeroProps {
  tone?: HeroTone;
  label?: string;
  headline: string;
  detail?: string;
  cta?: { text: string; ariaLabel?: string };
  secondary?: { text: string };
}

/** Sentinel + IntersectionObserver to detect when the hero scrolls past. */
function useScrolledPast(ref: React.RefObject<HTMLDivElement | null>): boolean {
  const [scrolledPast, setScrolledPast] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const obs = new IntersectionObserver(
      ([entry]) => setScrolledPast(!entry.isIntersecting),
      { threshold: 0, rootMargin: '0px 0px -100% 0px' },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [ref]);
  return scrolledPast;
}

const TONE_CLS: Record<HeroTone, string> = {
  action: 'bg-emerald-600/15 border-emerald-500/40 text-emerald-50',
  waiting: 'bg-cyan-600/10 border-cyan-500/30 text-cyan-50',
  aborted: 'bg-red-600/15 border-red-500/40 text-red-50',
  privacy: 'bg-amber-600/10 border-amber-500/30 text-amber-50',
};

const TONE_LABEL: Record<HeroTone, string> = {
  action: 'text-emerald-300',
  waiting: 'text-cyan-300',
  aborted: 'text-red-300',
  privacy: 'text-amber-300',
};

function HeroCta({ cta, tone }: { cta: { text: string; ariaLabel?: string }; tone: HeroTone }): JSX.Element {
  const cls = tone === 'aborted'
    ? 'bg-red-500 hover:bg-red-400 text-white'
    : tone === 'privacy'
      ? 'bg-amber-500 hover:bg-amber-400 text-amber-950'
      : 'bg-emerald-500 hover:bg-emerald-400 text-emerald-950';
  return (
    <button
      type="button"
      aria-label={cta.ariaLabel ?? cta.text}
      className={`flex-shrink-0 px-5 py-3 text-base font-semibold rounded-lg shadow-md transition-colors ${cls}`}
    >
      {cta.text}
    </button>
  );
}

function HeroBody({ tone, label, headline, detail, cta, secondary }: HeroProps): JSX.Element {
  const t: HeroTone = tone ?? 'action';
  return (
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
      <div className="min-w-0">
        <p className={`text-xs font-semibold uppercase tracking-[0.2em] mb-1 ${TONE_LABEL[t]}`}>
          {label ?? 'Your next step'}
        </p>
        <h2 className="text-xl md:text-2xl font-bold text-foreground leading-tight">
          {headline}
        </h2>
        {detail && <p className="text-sm text-secondary mt-2 max-w-2xl">{detail}</p>}
        {secondary && (
          <button type="button" className="mt-3 text-sm font-medium underline text-secondary hover:text-foreground">
            {secondary.text}
          </button>
        )}
      </div>
      {cta && <HeroCta cta={cta} tone={t} />}
    </div>
  );
}

function HeroCompactBody({ headline, cta, tone }: { headline: string; cta?: HeroProps['cta']; tone: HeroTone }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2">
      <p className={`text-xs font-semibold uppercase tracking-[0.15em] truncate ${TONE_LABEL[tone]}`}>
        Next: <span className="text-foreground normal-case font-semibold">{headline}</span>
      </p>
      {cta && (
        <button
          type="button"
          aria-label={cta.ariaLabel ?? cta.text}
          className="flex-shrink-0 px-3 py-1.5 text-xs font-semibold rounded bg-emerald-500 hover:bg-emerald-400 text-emerald-950"
        >
          {cta.text}
        </button>
      )}
    </div>
  );
}

/** Sticky-on-mobile, in-flow on desktop. */
export function HeroNextStep(props: HeroProps): JSX.Element {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const compact = useScrolledPast(sentinelRef);
  const tone: HeroTone = props.tone ?? 'action';

  return (
    <>
      {/* Sentinel marks the hero's natural top. When it leaves the viewport we go compact. */}
      <div ref={sentinelRef} aria-hidden="true" />
      <section
        data-testid="hero-next-step"
        data-tone={tone}
        className={`md:static sticky top-0 z-30 border md:border-y md:border-x-0 rounded-lg md:rounded-none px-4 md:px-6 py-4 md:py-6 mb-4 md:mb-6 backdrop-blur-md transition-all duration-200 ${TONE_CLS[tone]} ${compact ? 'md:opacity-100 opacity-50 py-2 md:py-6' : ''}`}
      >
        {/* Mobile compact form (only when scrolled past). Hidden on desktop. */}
        <div className={`md:hidden ${compact ? 'block' : 'hidden'}`}>
          <HeroCompactBody headline={props.headline} cta={props.cta} tone={tone} />
        </div>
        {/* Default form. Hidden on mobile when compact. */}
        <div className={compact ? 'md:block hidden' : 'block'}>
          <HeroBody {...props} />
        </div>
      </section>
    </>
  );
}

interface HeroExtras {
  done?: ReactNode;
}

/** Optional content slot rendered inside the hero block when present (e.g. micro-stats). */
export function HeroNextStepWithExtras(props: HeroProps & HeroExtras): JSX.Element {
  return (
    <>
      <HeroNextStep {...props} />
      {props.done && <div className="-mt-2 mb-4 text-xs text-muted">{props.done}</div>}
    </>
  );
}
