/**
 * ROK-1789 Part B (B-4) — one raid instance on the Progression tab, the
 * approved prototype's `TierRow` (`RaidProgression.tsx` @ 9f2a1103c): name,
 * "On farm" once cleared, `down/total` (or `down/?` when the boss total is
 * unknown, B2), the shared `GuildMeter` (success cleared / warning otherwise;
 * omitted when the total is unknown), the latest kill, then every boss row.
 */
import type { JSX } from 'react';
import type { WowProgressionInstanceDto } from '@raid-ledger/contract';
import { GuildMeter } from '../../../components/hub/events/guild-meter';
import { StatusChip } from '../../../components/ui/status-chip';
import { ProgressionBossRow } from './progression-boss-row';
import { shortDate } from './progression.helpers';

type Instance = WowProgressionInstanceDto;

function InstanceHeader({ instance, cleared }: { instance: Instance; cleared: boolean }): JSX.Element {
    const total = instance.bossTotal === null ? '?' : String(instance.bossTotal);
    return (
        <div className="flex items-center justify-between gap-2">
            <h3 className="truncate text-sm font-semibold text-foreground">{instance.name}</h3>
            <span className="flex shrink-0 items-center gap-2">
                {cleared && <StatusChip tone="success" title="Every boss in this raid has been killed">On farm</StatusChip>}
                <span data-testid="progression-instance-count" className="text-sm font-bold text-foreground">{instance.bossesDown}/{total}</span>
            </span>
        </div>
    );
}

/** One instance section: header, meter, latest kill and the boss list. */
export function ProgressionInstance({ instance }: { instance: Instance }): JSX.Element {
    const total = instance.bossTotal;
    const cleared = total !== null && total > 0 && instance.bossesDown >= total;
    return (
        <li data-testid="progression-instance" data-instance-key={instance.key}
            className="flex flex-col gap-2 rounded-lg border border-edge bg-panel p-4">
            <InstanceHeader instance={instance} cleared={cleared} />
            {total !== null && total > 0 && (
                <GuildMeter pct={(instance.bossesDown / total) * 100} tone={cleared ? 'success' : 'warning'}
                    label={`${instance.name}: ${instance.bossesDown} of ${total} bosses down`} />
            )}
            {instance.latestKill !== null && (
                <p data-testid="progression-latest-kill" className="text-xs text-muted">
                    Latest kill: {instance.latestKill.name} · {shortDate(instance.latestKill.at)}
                </p>
            )}
            <ul aria-label={`${instance.name} bosses`} className="mt-1 divide-y divide-edge border-t border-edge">
                {instance.bosses.map((b) => (
                    <ProgressionBossRow key={`${b.encounterId}:${b.difficultyId}`} boss={b} showDifficulty={instance.showDifficulty} />
                ))}
            </ul>
        </li>
    );
}
