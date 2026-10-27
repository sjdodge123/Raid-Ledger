/**
 * ROK-1922 (epic ROK-1905 W3) — Role breakdown for a WoW: Forever guild hub:
 * how many dungeon-ready and raid-ready members play each role, so a leader
 * can tell at a glance whether a 5-man or a raid can form tonight. Counts are
 * one role per user, resolved server-side. Each role links to the Members tab
 * (it has no role filter yet).
 */
import type { JSX } from 'react';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { RoleIcon } from '../../../components/shared/RoleIcon';
import { FOCUS_RING } from '../../../components/ui/form-classes';
import { ROLE_META } from '../hub/wow-guild.helpers';
import { useRosterInsights } from './use-roster-insights';
import { FreshnessFooter } from './freshness-footer';
import { BAND_ROLES, roleLinkLabel, type BandRole, type RoleBandKey, type RoleBands } from './roles.helpers';

const BAND_TITLE: Record<RoleBandKey, string> = { dungeon: 'Dungeon-ready', raid: 'Raid-ready' };

function RoleMark({ role }: { role: BandRole }): JSX.Element {
    if (role === 'unknown') {
        return <span aria-hidden="true" className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-edge text-[10px] font-bold text-muted">?</span>;
    }
    return <RoleIcon role={role} size="h-4 w-4" />;
}

function RoleLink({ band, role, count }: { band: RoleBandKey; role: BandRole; count: number }): JSX.Element {
    const tint = role === 'unknown' ? 'border-edge' : ROLE_META[role].cls;
    return (
        <a href="#members" data-testid={`forever-roles-${band}-${role}`} aria-label={roleLinkLabel(band, role, count)}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border bg-panel px-2.5 hover:bg-overlay ${tint} ${FOCUS_RING}`}>
            <RoleMark role={role} />
            <span className="text-sm font-semibold text-foreground">{count}</span>
            <span className="text-sm text-secondary">{role === 'unknown' ? 'Unknown' : ROLE_META[role].label}</span>
        </a>
    );
}

function Band({ band, roles }: { band: RoleBandKey; roles: RoleBands }): JSX.Element {
    return (
        <section data-testid={`forever-roles-band-${band}`} aria-label={BAND_TITLE[band]} className="flex flex-col gap-1.5">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">{BAND_TITLE[band]}</h4>
            <ul className="flex flex-wrap gap-2">
                {BAND_ROLES.map((role) => <li key={role}><RoleLink band={band} role={role} count={roles[band][role]} /></li>)}
            </ul>
        </section>
    );
}

/** The widget body; core draws the card chrome and title. */
export default function RolesWidget({ page }: HubWidgetCtx): JSX.Element | null {
    const { data } = useRosterInsights(page.guild.id);
    if (data === undefined) return null;
    return (
        <div className="flex flex-col gap-3">
            <Band band="dungeon" roles={data.roles} />
            <Band band="raid" roles={data.roles} />
            {data.freshness.roster !== null && <FreshnessFooter freshness={data.freshness.roster} testId="forever-roles-freshness" />}
        </div>
    );
}
