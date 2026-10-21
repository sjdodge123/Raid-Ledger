/**
 * ROK-1875 — the phone bottom bar with its raised centre Hubs circle, rendered
 * statically (the real bar is `position: fixed` + `md:hidden`) at the three
 * phone widths the operator checks: 320 / 375 / 430px. Labels never truncate,
 * the circle stays inside its column, and the bar never overflows.
 */
import type { JSX } from 'react';
import { BottomTabGrid } from '../../components/layout/bottom-tab-bar';
import { StateFrame } from './design-system-bits';

const WIDTHS = [320, 375, 430] as const;

/** Static replicas of the bottom bar, one per phone width. */
export function BottomNavDemo(): JSX.Element {
    return (
        <StateFrame label="Bottom bar — raised Hubs (static)" note="Five even columns; bg-success circle, 56px, raised 24px (§3.2).">
            <div className="flex flex-col gap-4 overflow-x-auto">
                {WIDTHS.map((w) => (
                    <div key={w} data-testid={`ds-bottom-nav-${w}`} className="shrink-0 pt-8" style={{ width: w }}>
                        <p className="mb-1 text-xs text-muted">{w}px</p>
                        <div className="relative border-t border-edge-subtle bg-surface">
                            <BottomTabGrid pathname="/calendar" />
                        </div>
                    </div>
                ))}
            </div>
        </StateFrame>
    );
}
