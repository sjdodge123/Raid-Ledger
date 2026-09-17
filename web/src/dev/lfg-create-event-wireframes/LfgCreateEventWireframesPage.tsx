/**
 * ROK-1573/1572/1571 — in-context LFG wireframes in the scheduling-poll hero
 * language. DEMO_MODE-gated, dev-only. Route: `/dev/wireframes/lfg-create-event`.
 *
 * Renders the REAL LFG group page composition with fixture data (no network):
 * a top bar (back, copy link, ⋯ in the top bar for Manage), one `JourneyHero`
 * card (Participants chip; one Start a scheduling poll in the row under it)
 * and a Lock in this event per shared time. Tabs H1–H7. "Phone
 * width" loads this same route in a 390px iframe with `?frame=1`, so viewport
 * media queries (`md:` breakpoints, sheet-vs-modal) behave as on a phone.
 *
 * Gated identically to `scheduling-wireframes`: `useSystemStatus().demoMode`,
 * redirect to `/` when false, lazily imported from `lazy-routes.ts`.
 */
import { useState, type JSX } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useSystemStatus } from '../../hooks/use-system-status';
import { WfLfgGroupPage } from './WfLfgGroupPage';
import { WF_VARIANTS, type WfVariantId } from './wireframe-variants';

const PHONE_WIDTH = 390;

/** DEMO_MODE gate — mirrors `SchedulingWireframesPage`. */
function useDemoMode(): { ready: boolean; allowed: boolean } {
    const { data, isLoading } = useSystemStatus();
    if (isLoading) return { ready: false, allowed: false };
    return { ready: true, allowed: data?.demoMode === true };
}

/** Parse `?variant=`; anything unknown falls back to H1. */
function toVariant(raw: string | null): WfVariantId {
    return WF_VARIANTS.find((v) => v.id === raw)?.id ?? 'H1';
}

/** Variant tabs + the phone-width toggle. */
function Toolbar({ variant, phone, onVariant, onPhone }: {
    variant: WfVariantId; phone: boolean;
    onVariant: (id: WfVariantId) => void; onPhone: () => void;
}): JSX.Element {
    const tab = (on: boolean): string =>
        `rounded-md px-3 py-1.5 text-xs font-semibold ${on ? 'bg-emerald-600 text-white' : 'bg-overlay text-foreground hover:bg-faint'}`;
    return (
        <div className="flex flex-wrap items-center gap-2">
            {WF_VARIANTS.map((v) => (
                <button key={v.id} type="button" aria-pressed={v.id === variant} className={tab(v.id === variant)} onClick={() => onVariant(v.id)}>
                    {v.label}
                </button>
            ))}
            <button type="button" aria-pressed={phone} className={`ml-auto ${tab(phone)}`} onClick={onPhone}>
                Phone width ({PHONE_WIDTH}px)
            </button>
        </div>
    );
}

/** A 390px iframe of this route in frame mode. */
function PhoneFrame({ variant }: { variant: WfVariantId }): JSX.Element {
    return (
        <div className="flex justify-center">
            <iframe
                key={variant}
                data-testid="wf-phone-frame"
                title={`LFG wireframe ${variant} at phone width`}
                src={`/dev/wireframes/lfg-create-event?frame=1&variant=${variant}`}
                width={PHONE_WIDTH}
                height={844}
                className="rounded-2xl border border-edge bg-backdrop"
            />
        </div>
    );
}

/** Route chrome: header, tabs, then the page (inline or framed). */
function WireframeShell(): JSX.Element {
    const [params, setParams] = useSearchParams();
    const variant = toVariant(params.get('variant'));
    const [phone, setPhone] = useState(false);
    const setVariant = (id: WfVariantId): void => setParams({ variant: id }, { replace: true });
    const blurb = WF_VARIANTS.find((v) => v.id === variant)?.blurb;
    return (
        <div className="space-y-4 py-4">
            <header className="mx-auto max-w-4xl space-y-3 border-b border-edge px-4 pb-3">
                <h1 className="text-xl font-semibold text-foreground">ROK-1573 / 1572 / 1571 — the LFG group in the poll hero language</h1>
                <p className="text-sm text-secondary">Proposed changes drawn on the real /lfg/:gameSlug page with fixture data. {blurb}</p>
                <Toolbar variant={variant} phone={phone} onVariant={setVariant} onPhone={() => setPhone((p) => !p)} />
            </header>
            {phone ? <PhoneFrame variant={variant} /> : <WfLfgGroupPage key={variant} variant={variant} onVariant={setVariant} />}
        </div>
    );
}

/** Frame mode: the page alone, for the phone iframe. */
function FramedPage(): JSX.Element {
    const [params] = useSearchParams();
    const [variant, setVariant] = useState(toVariant(params.get('variant')));
    return <WfLfgGroupPage key={variant} variant={variant} onVariant={setVariant} />;
}

/** `/dev/wireframes/lfg-create-event`. */
export function LfgCreateEventWireframesPage(): JSX.Element | null {
    const { ready, allowed } = useDemoMode();
    const [params] = useSearchParams();
    if (!ready) return null;
    if (!allowed) return <Navigate to="/" replace />;
    return params.get('frame') === '1' ? <FramedPage /> : <WireframeShell />;
}
