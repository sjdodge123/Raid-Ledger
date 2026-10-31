/**
 * Wizard sub-step rail (ROK-1703, design-system §4.33). A vertical step list
 * at ≥1024px; below that (§4.18) it collapses to "Connect Discord · n of 5".
 * Steps up to `reachable` are buttons; later ones are inert.
 */
import { Button } from '../../../ui/button';
import { DISCORD_SUBSTEPS, type DiscordSubstep } from './use-discord-substep';

interface RailProps {
    current: number;
    reachable: number;
    onSelect: (step: DiscordSubstep) => void;
}

function Marker({ index, current }: { index: number; current: number }) {
    const base = 'w-6 h-6 shrink-0 rounded-full border flex items-center justify-center text-xs font-semibold';
    if (index < current) {
        return (
            <span className={`${base} border-success/40 bg-success/10 text-success`} aria-hidden="true">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
            </span>
        );
    }
    const tone = index === current ? 'border-success text-success' : 'border-edge text-muted';
    return <span className={`${base} ${tone}`} aria-hidden="true">{index + 1}</span>;
}

function RailItem({ index, current, reachable, onSelect }: RailProps & { index: number }) {
    const step = DISCORD_SUBSTEPS[index];
    if (!step) return null;
    const isCurrent = index === current;
    const text = isCurrent ? 'text-foreground font-semibold' : 'text-muted';
    const inner = <><Marker index={index} current={current} /><span className={`text-sm ${text}`}>{step.label}</span></>;
    const cls = `w-full flex items-center gap-3 min-h-[44px] px-2 rounded-lg ${isCurrent ? 'bg-overlay' : ''}`;
    if (index > reachable || isCurrent) {
        return <li><div className={cls} aria-current={isCurrent ? 'step' : undefined}>{inner}</div></li>;
    }
    return (
        <li>
            <Button variant="bare" className={`${cls} hover:bg-overlay text-left justify-start`} onClick={() => onSelect(step.key)}>{inner}</Button>
        </li>
    );
}

export function DiscordSubstepRail(props: RailProps) {
    const label = DISCORD_SUBSTEPS[props.current]?.label ?? '';
    return (
        <>
            <p className="lg:hidden mb-4 text-sm text-muted" data-testid="discord-rail-compact">
                Connect Discord · {props.current + 1} of {DISCORD_SUBSTEPS.length}{' '}
                <span className="font-medium text-foreground">{label}</span>
            </p>
            <nav aria-label="Connect Discord" className="hidden lg:block">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Connect Discord</p>
                <ol className="space-y-1">
                    {DISCORD_SUBSTEPS.map((s, i) => <RailItem key={s.key} index={i} {...props} />)}
                </ol>
            </nav>
        </>
    );
}
