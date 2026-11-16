/**
 * ROK-2216 — the Dungeon planner hub tab. PLACEHOLDER (lane 2): lane 3
 * replaces this body with the ported prototype (spec "Tab folder").
 */
import type { JSX } from 'react';
import type { HubCtx } from '../../../hub-module';

/** The tab body (default export: `dungeonPlannerTab` lazy-loads it). */
export default function DungeonPlannerTab({ page }: Pick<HubCtx, 'page'>): JSX.Element {
    return <p className="text-sm text-muted">Dungeon planner — {page.guild.name}</p>;
}
