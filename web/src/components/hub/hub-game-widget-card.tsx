/**
 * ROK-1909 — the chrome around one plugin game widget: `WidgetCard`, a Suspense
 * skeleton for its lazy body, and the error boundary that keeps a throwing
 * widget inside its own cell. Components only (fast refresh); the cell builder
 * is `hub-widget-cells.tsx`.
 */
import { Component, Suspense, type ErrorInfo, type JSX, type ReactNode } from 'react';
import type { HubGameWidgetRegistration, HubWidgetCtx } from '../../plugins/hub-game-widgets';
import { WidgetCard } from './hub-bits';

/** 1 / 2 / 3 columns at ≥1024px; 3 clamps to the two columns ≥768px has; phone is always one. */
const SPAN_CLASS: Record<1 | 2 | 3, string | undefined> = {
    1: undefined,
    2: 'md:col-span-2',
    3: 'md:col-span-2 lg:col-span-3',
};

export interface BoundaryProps {
    fallback: ReactNode;
    children: ReactNode;
}

/** Keeps one widget's render error inside its own cell. */
export class WidgetBoundary extends Component<BoundaryProps, { failed: boolean }> {
    state = { failed: false };

    static getDerivedStateFromError(): { failed: boolean } {
        return { failed: true };
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
        console.error('Hub widget failed to render', error, info.componentStack);
    }

    render(): ReactNode {
        return this.state.failed ? this.props.fallback : this.props.children;
    }
}

function WidgetSkeleton(): JSX.Element {
    return <div className="h-24 animate-pulse rounded-md bg-panel" aria-busy="true" data-testid="hub-widget-loading" />;
}

const BODY_ERROR = <p role="alert" className="text-sm text-muted">Couldn't load this widget.</p>;

export interface CardProps {
    reg: HubGameWidgetRegistration;
    ctx: HubWidgetCtx;
}

export function GameWidgetCard({ reg, ctx }: CardProps): JSX.Element {
    const { pluginSlug, widget } = reg;
    const Body = widget.component;
    const Action = widget.action;
    const id = `hub-widget-${pluginSlug}-${widget.id}`;
    const span = SPAN_CLASS[widget.span ?? 1];
    const body = (
        <WidgetBoundary fallback={BODY_ERROR}>
            <Suspense fallback={<WidgetSkeleton />}><Body {...ctx} /></Suspense>
        </WidgetBoundary>
    );
    // `chrome: 'none'` — the body owns its landmark and frame; the cell keeps id + span.
    if (widget.chrome === 'none') return <div id={id} className={`scroll-mt-4 ${span ?? ''}`}>{body}</div>;
    return (
        <div className={span}>
            <WidgetCard id={id} title={widget.title} action={Action ? <Action {...ctx} /> : undefined}>{body}</WidgetCard>
        </div>
    );
}

/** Asks the widget's own `useVisible` hook first; mounted only for widgets that have one. */
export function ProbedGameWidget({ useVisible, ...props }: CardProps & { useVisible: (ctx: HubWidgetCtx) => boolean }): JSX.Element | null {
    return useVisible(props.ctx) ? <GameWidgetCard {...props} /> : null;
}

