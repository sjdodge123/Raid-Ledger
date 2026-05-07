/**
 * Hero "Your next step" banner (ROK-1209). Productionized from the
 * lineup-wireframes prototype. Mobile sticky-on-scroll with compact
 * mode driven by an IntersectionObserver sentinel; in-flow on desktop.
 *
 * Tones: action / waiting / aborted / privacy.
 */
import { useEffect, useRef, useState, type JSX } from 'react';
import { flushSync } from 'react-dom';

export type HeroTone = 'action' | 'waiting' | 'aborted' | 'privacy';

export interface HeroCta {
    text: string;
    onClick?: () => void;
    ariaLabel?: string;
    disabled?: boolean;
    tooltip?: string;
}

export interface HeroSecondary {
    text: string;
    onClick?: () => void;
}

export interface HeroNextStepProps {
    tone?: HeroTone;
    label?: string;
    headline: string;
    detail?: string;
    cta?: HeroCta;
    secondary?: HeroSecondary;
}

const TONE_CLS: Record<HeroTone, string> = {
    action: 'bg-emerald-600/15 border-emerald-500/40 text-emerald-50',
    waiting: 'bg-cyan-600/10 border-cyan-500/30 text-cyan-50',
    aborted: 'bg-red-600/15 border-red-500/40 text-red-50',
    privacy: 'bg-amber-600/10 border-amber-500/30 text-amber-50',
};

const TONE_LABEL_CLS: Record<HeroTone, string> = {
    action: 'text-emerald-300',
    waiting: 'text-cyan-300',
    aborted: 'text-red-300',
    privacy: 'text-amber-300',
};

const CTA_CLS: Record<HeroTone, string> = {
    action: 'bg-emerald-500 hover:bg-emerald-400 text-emerald-950',
    waiting: 'bg-emerald-500 hover:bg-emerald-400 text-emerald-950',
    aborted: 'bg-red-500 hover:bg-red-400 text-white',
    privacy: 'bg-amber-500 hover:bg-amber-400 text-amber-950',
};

function useScrolledPast(ref: React.RefObject<HTMLDivElement | null>): boolean {
    const [past, setPast] = useState(false);
    useEffect(() => {
        const node = ref.current;
        if (!node || typeof IntersectionObserver === 'undefined') return;
        const obs = new IntersectionObserver(
            ([entry]) => {
                flushSync(() => setPast(!entry.isIntersecting));
            },
            { threshold: 0, rootMargin: '0px 0px -100% 0px' },
        );
        obs.observe(node);
        return () => obs.disconnect();
    }, [ref]);
    return past;
}

function CtaButton({ cta, tone }: { cta: HeroCta; tone: HeroTone }): JSX.Element {
    return (
        <button
            type="button"
            onClick={cta.onClick}
            disabled={cta.disabled}
            aria-label={cta.ariaLabel ?? cta.text}
            title={cta.tooltip}
            className={`flex-shrink-0 px-5 py-3 text-base font-semibold rounded-lg shadow-md transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${CTA_CLS[tone]}`}
        >
            {cta.text}
        </button>
    );
}

function HeroFull(props: HeroNextStepProps): JSX.Element {
    const tone: HeroTone = props.tone ?? 'action';
    return (
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="min-w-0">
                <p className={`text-xs font-semibold uppercase tracking-[0.2em] mb-1 ${TONE_LABEL_CLS[tone]}`}>
                    {props.label ?? 'Your next step'}
                </p>
                <h2 className="text-xl md:text-2xl font-bold text-foreground leading-tight">
                    {props.headline}
                </h2>
                {props.detail && (
                    <p className="text-sm text-secondary mt-2 max-w-2xl">{props.detail}</p>
                )}
                {props.secondary && (
                    <button
                        type="button"
                        onClick={props.secondary.onClick}
                        className="mt-3 text-sm font-medium underline text-secondary hover:text-foreground"
                    >
                        {props.secondary.text}
                    </button>
                )}
            </div>
            {props.cta && <CtaButton cta={props.cta} tone={tone} />}
        </div>
    );
}

function HeroCompact({
    headline, cta, tone,
}: { headline: string; cta?: HeroCta; tone: HeroTone }): JSX.Element {
    return (
        <div className="flex items-center justify-between gap-3 min-h-[44px]">
            <p className={`text-sm font-semibold uppercase tracking-[0.15em] truncate ${TONE_LABEL_CLS[tone]}`}>
                Next: <span className="text-foreground normal-case font-semibold">{headline}</span>
            </p>
            {cta && <CtaButton cta={cta} tone={tone} />}
        </div>
    );
}

export function HeroNextStep(props: HeroNextStepProps): JSX.Element {
    const sentinelRef = useRef<HTMLDivElement | null>(null);
    const compact = useScrolledPast(sentinelRef);
    const tone: HeroTone = props.tone ?? 'action';

    return (
        <>
            <div ref={sentinelRef} aria-hidden="true" />
            <section
                data-testid="hero-next-step"
                data-tone={tone}
                data-compact={compact ? 'true' : 'false'}
                className={`md:static sticky top-0 z-30 border md:border-y md:border-x-0 rounded-lg md:rounded-none px-4 md:px-6 py-4 md:py-6 mb-4 md:mb-6 backdrop-blur-md transition-all duration-200 ${TONE_CLS[tone]} ${compact ? 'md:opacity-100 opacity-90 py-2 md:py-6' : ''}`}
            >
                {compact ? (
                    <HeroCompact headline={props.headline} cta={props.cta} tone={tone} />
                ) : (
                    <HeroFull {...props} />
                )}
            </section>
        </>
    );
}
