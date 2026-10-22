/**
 * ROK-1909 (epic ROK-1905 H2) — the Overview cells for plugin game widgets
 * (`PluginHandle.registerHubWidget`). Each one is a `WidgetCard` with a
 * Suspense skeleton around its lazy body and two error boundaries: one inside
 * the card (a throwing body says so in place) and one around the whole cell (a
 * throwing `useVisible` or header action drops just that card). Either way the
 * rest of the Overview keeps rendering.
 */
import { Component, Suspense, type ErrorInfo, type JSX, type ReactNode } from 'react';
import type { HubCtx } from '../../plugins/hub-module';
import {
    gatedHubGameWidgets, type HubGameWidgetRegistration, type HubWidgetCtx,
} from '../../plugins/hub-game-widgets';
import { WidgetCard } from './hub-bits';

/** One Overview cell — the node carries its own column span, so a hidden widget leaves no empty grid item. */
export interface GameWidgetCell {
    key: `plugin:${string}`;
    order: number;
    node: ReactNode;
}

/** 1 / 2 / 3 columns at ≥1024px; 3 clamps to the two columns ≥768px has; phone is always one. */
const SPAN_CLASS: Record<1 | 2 | 3, string | undefined> = {
    1: undefined,
    2: 'md:col-span-2',
    3: 'md:col-span-2 lg:col-span-3',
};

interface BoundaryProps {
    fallback: ReactNode;
    children: ReactNode;
}

/** Keeps one widget's render error inside its own cell. */
class WidgetBoundary extends Component<BoundaryProps, { failed: boolean }> {
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

interface CardProps {
    reg: HubGameWidgetRegistration;
    ctx: HubWidgetCtx;
}

function GameWidgetCard({ reg, ctx }: CardProps): JSX.Element {
    const { pluginSlug, widget } = reg;
    const Body = widget.component;
    const Action = widget.action;
    return (
        <div className={SPAN_CLASS[widget.span ?? 1]}>
            <WidgetCard id={`hub-widget-${pluginSlug}-${widget.id}`} title={widget.title} action={Action ? <Action {...ctx} /> : undefined}>
                <WidgetBoundary fallback={BODY_ERROR}>
                    <Suspense fallback={<WidgetSkeleton />}><Body {...ctx} /></Suspense>
                </WidgetBoundary>
            </WidgetCard>
        </div>
    );
}

/** Asks the widget's own `useVisible` hook first; mounted only for widgets that have one. */
function ProbedGameWidget({ useVisible, ...props }: CardProps & { useVisible: (ctx: HubWidgetCtx) => boolean }): JSX.Element | null {
    return useVisible(props.ctx) ? <GameWidgetCard {...props} /> : null;
}

/**
 * The plugin game widgets this viewer may see on this hub, as Overview cells.
 * Gating: plugin active, game and kind match, audience allows, then `useVisible`.
 */
export function gameWidgetCells(ctx: HubCtx, activeSlugs: ReadonlySet<string>): GameWidgetCell[] {
    const gameSlug = ctx.page.guild.gameSlug;
    if (gameSlug === undefined) return [];
    const widgetCtx: HubWidgetCtx = { ...ctx, gameSlug };
    return gatedHubGameWidgets(ctx.page, activeSlugs).map((reg) => {
        const probe = reg.widget.useVisible;
        const card = probe
            ? <ProbedGameWidget reg={reg} ctx={widgetCtx} useVisible={probe} />
            : <GameWidgetCard reg={reg} ctx={widgetCtx} />;
        return {
            key: `plugin:${reg.pluginSlug}:${reg.widget.id}`,
            order: reg.widget.order,
            node: <WidgetBoundary fallback={null}>{card}</WidgetBoundary>,
        };
    });
}
