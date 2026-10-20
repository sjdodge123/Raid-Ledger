/**
 * ROK-1870 wireframe — shared frame bits: titled frames, desktop/phone device
 * outlines, and static stand-ins for the Modal / BottomSheet overlays and the
 * funnel trigger + Filters FAB (design-system §4.1, §4.4). Tokens only.
 */
import type { JSX, ReactNode } from 'react';
import { Button } from '../../components/ui/button';

export function Frame({ title, note, children }: { title: string; note: string; children: ReactNode }): JSX.Element {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="text-xs text-muted">{note}</p>
      <div className="flex flex-wrap items-start gap-6">{children}</div>
    </section>
  );
}

/** A labelled viewport outline — phone is 390px wide, desktop fills the row. */
export function Device({ kind, children }: { kind: 'desktop' | 'phone'; children: ReactNode }): JSX.Element {
  const width = kind === 'phone' ? 'w-[390px] max-w-full' : 'min-w-0 flex-1 basis-[640px]';
  return (
    <div className={width}>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{kind === 'phone' ? 'Phone (390px)' : 'Desktop (≥1024px)'}</p>
      <div className="relative overflow-hidden rounded-xl border border-edge bg-backdrop p-3">{children}</div>
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }): JSX.Element {
  return <div className={`rounded-lg border border-edge bg-surface p-4 ${className}`}>{children}</div>;
}

/** Static stand-in for a centred `Modal` (≥1024px). */
export function ModalMock({ title, children, footer }: { title: string; children: ReactNode; footer: ReactNode }): JSX.Element {
  return (
    <div className="flex justify-center rounded-lg bg-overlay/60 p-6">
      <div className="w-full max-w-md rounded-xl border border-edge-strong bg-surface shadow-lg">
        <div className="border-b border-edge px-5 py-3 text-base font-semibold text-foreground">{title}</div>
        <div className="space-y-4 px-5 py-4">{children}</div>
        <div className="flex justify-end gap-2 border-t border-edge px-5 py-3">{footer}</div>
      </div>
    </div>
  );
}

/** Static stand-in for a `BottomSheet` (<1024px): grabber, title, body, sticky footer. */
export function SheetMock({ title, children, footer }: { title: string; children: ReactNode; footer: ReactNode }): JSX.Element {
  return (
    <div className="flex min-h-[520px] flex-col justify-end rounded-lg bg-overlay/60">
      <div className="rounded-t-2xl border border-edge-strong bg-surface shadow-lg">
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-overlay" aria-hidden="true" />
        <div className="px-4 pb-2 pt-3 text-base font-semibold text-foreground">{title}</div>
        <div className="space-y-4 px-4 pb-4">{children}</div>
        <div className="flex gap-2 border-t border-edge px-4 py-3">{footer}</div>
      </div>
    </div>
  );
}

function FunnelIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M3 4h14l-5.5 6.5V16l-3 1.5v-7L3 4z" strokeLinejoin="round" />
    </svg>
  );
}

/** Toolbar funnel (desktop) — the `FilterEntryTrigger` look, badge = active filters. */
export function FunnelTriggerMock({ active, open, onClick }: { active: number; open: boolean; onClick: () => void }): JSX.Element {
  return (
    <Button variant="secondary" size="sm" aria-expanded={open} onClick={onClick} className="relative">
      <FunnelIcon />
      <span>Filters</span>
      {active > 0 && <span className="ml-1 rounded-full bg-success px-1.5 text-xs font-semibold text-white">{active}</span>}
    </Button>
  );
}

/** Neutral Filters FAB (<1024px) — `bg-surface border-edge-strong`, never the emerald create fill. */
export function FilterFabMock({ active, onClick }: { active: number; onClick: () => void }): JSX.Element {
  return (
    <Button variant="bare" aria-label="Filters" onClick={onClick}
      className="absolute bottom-4 right-4 flex h-14 w-14 items-center justify-center rounded-full border border-edge-strong bg-surface text-foreground shadow-lg">
      <FunnelIcon />
      {active > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-success px-1.5 text-xs font-semibold text-white">{active}</span>}
    </Button>
  );
}
