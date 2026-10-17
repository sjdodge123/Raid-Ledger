/** ROK-1787 — role composition & bench for the next raid (prototype `proposed/RoleComposition.tsx`). */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import type { GuildCompositionDto, GuildRoleNeedDto } from '@raid-ledger/contract';
import { RoleIcon } from '../../../components/shared/RoleIcon';
import { FOCUS_RING } from '../../../components/ui/form-classes';
import { CharacterLink } from './character-link';
import { Pill, WidgetCard } from '../../../components/hub/hub-bits';
import { GuildMeter } from '../../../components/hub/events/guild-meter';
import { percent, whenLabel } from '../../../components/hub/events/guild-raids.helpers';
import { QuietEmpty } from './raids-bits';
import { ROLE_META } from './wow-guild.helpers';

function RoleRow({ need }: { need: GuildRoleNeedDto }): JSX.Element {
    const meta = ROLE_META[need.role];
    const short = Math.max(0, need.needed - need.filled);
    return (
        <li data-testid={`guild-composition-${need.role}`} className={`flex flex-col gap-1.5 border-l-2 pl-2.5 ${meta.cls}`}>
            <div className="flex items-center gap-2">
                <RoleIcon role={need.role} size="h-4 w-4" />
                <span className="flex-1 text-sm font-medium text-foreground">{meta.label}</span>
                <span className="text-sm text-secondary"><span className="font-bold text-foreground">{need.filled}</span> / {need.needed}</span>
                {short > 0 ? <Pill tone="warning">Need {short}</Pill> : <Pill tone="success">Full</Pill>}
            </div>
            <GuildMeter pct={percent(need.filled, need.needed)} tone={short > 0 ? 'warning' : 'success'}
                label={`${meta.label}: ${need.filled} of ${need.needed} filled`} />
        </li>
    );
}

function Bench({ benched }: { benched: GuildCompositionDto['benched'] }): JSX.Element | null {
    if (benched.length === 0) return null;
    return (
        <div className="mt-3 flex flex-wrap items-center gap-1.5" data-testid="guild-bench">
            <span className="text-xs font-medium text-muted">Benched:</span>
            {benched.map((b) => <Pill key={`${b.characterId ?? 'none'}-${b.name}`}><CharacterLink name={b.name} characterId={b.characterId} className="text-secondary" /></Pill>)}
        </div>
    );
}

export function GuildRoleComposition({ composition }: { composition: GuildCompositionDto | null }): JSX.Element {
    return (
        <WidgetCard id="guild-role-composition" title="Role composition & bench">
            {composition === null ? <QuietEmpty>No upcoming raid with role slots. Composition shows once one is scheduled.</QuietEmpty> : (
                <>
                    <p className="mb-2 text-xs text-secondary">
                        Next raid: <Link to={`/events/${composition.event.id}`} className={`rounded-sm font-medium text-foreground hover:underline ${FOCUS_RING}`}>{composition.event.title}</Link> · {whenLabel(composition.event.startTime)}
                    </p>
                    <ul className="flex flex-col gap-3">{composition.roles.map((n) => <RoleRow key={n.role} need={n} />)}</ul>
                    <Bench benched={composition.benched} />
                </>
            )}
        </WidgetCard>
    );
}
