import type { ReactNode } from 'react';
import { Button } from '../../../ui/button';
import { DISCORD_SUBSTEPS } from './use-discord-substep';

/** Navigation every Discord sub-screen receives from the container. */
export interface SubstepNav {
    onNext: () => void;
    onBack: () => void;
}

/** The shared frame of one Discord sub-screen: "Step n of 5", title, lead, body, footer. */
export function SubstepScreen({ step, title, lead, children, footer }: {
    step: number; title: string; lead: ReactNode; children?: ReactNode; footer: ReactNode;
}) {
    return (
        <section aria-labelledby="discord-substep-title" className="space-y-6">
            <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">Step {step} of {DISCORD_SUBSTEPS.length}</p>
                <h2 id="discord-substep-title" className="mt-1 text-xl font-bold text-foreground">{title}</h2>
                <p className="mt-2 text-sm text-secondary">{lead}</p>
            </div>
            {children}
            {footer}
        </section>
    );
}

/** Back on the left; the primary action (plus an optional status line) on the right. */
export function SubstepFooter({ onBack, children, status }: { onBack: () => void; children: ReactNode; status?: ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-3 pt-4 border-t border-edge/50">
            <Button variant="ghost" onClick={onBack}>Back</Button>
            <div className="flex items-center gap-3">
                {status && <span className="text-sm text-muted" aria-live="polite">{status}</span>}
                {children}
            </div>
        </div>
    );
}

/** A quiet info note (neutral surface + icon), tone-able for warnings. */
export function SubstepNote({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'warning' }) {
    const cls = tone === 'warning' ? 'border-warning/30 bg-warning/5 text-warning' : 'border-edge bg-panel/50 text-secondary';
    return (
        <div className={`flex gap-2 rounded-lg border p-3 text-sm ${cls}`}>
            <svg className="w-4 h-4 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" /></svg>
            <div>{children}</div>
        </div>
    );
}
