/**
 * ROK-2352 §4.1 — the group view's "Your hand" card: the viewer's hand in
 * this group (with the grouping plugin's role/character badges) and "Also in:"
 * links to their other live hands in the same game (prototype B, "Your hands").
 *
 * Renders only while a grouping is active — the api sends `ownOtherGroups`
 * only then — and only when the viewer holds at least one hand in the game,
 * so a non-grouped game shows exactly today's page.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import type { LfgGroupDetailDto, LfgGroupRefDto } from '@raid-ledger/contract';
import { StatusChip } from '../../components/ui/status-chip';
import { buttonClass } from '../../components/ui/button-classes';
import type { LfgGrouping, LfgGroupingContext } from '../../plugins/lfg-grouping';
import { YOUR_HAND_COPY, lfgGroupHref, yourHandLabel } from './lfg-your-hand-copy';

export interface LfgYourHandCardProps {
    group: LfgGroupDetailDto;
    context: LfgGroupingContext;
    grouping: LfgGrouping | null;
}

/** This group's hand: its label chip plus the plugin's badges for the viewer's row. */
function OwnHand({ group, context, grouping }: LfgYourHandCardProps): JSX.Element {
    const own = group.ownIntent;
    if (own == null) return <p className="text-sm text-muted">{YOUR_HAND_COPY.notInGroup}</p>;
    const me = group.members.find((m) => m.userId === own.userId);
    const Badges = grouping?.MemberBadges;
    const label = yourHandLabel(grouping, { groupKey: context.groupKey, groupLabel: group.groupLabel ?? null });
    return (
        <div data-testid="lfg-your-hand-own" className="flex flex-wrap items-center gap-2">
            <StatusChip tone="success" title={YOUR_HAND_COPY.inThisGroup}>{label}</StatusChip>
            {Badges && me && <Badges context={context} member={me} />}
        </div>
    );
}

/** "Also in:" — one link per other live hand in the game. */
function AlsoIn({ others, context, grouping }: { others: readonly LfgGroupRefDto[]; context: LfgGroupingContext; grouping: LfgGrouping | null }): JSX.Element {
    const link = buttonClass({ variant: 'secondary', size: 'sm' });
    return (
        <div data-testid="lfg-your-hand-also-in" className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">{YOUR_HAND_COPY.alsoIn}</span>
            {others.map((ref) => (
                <Link key={ref.groupKey} to={lfgGroupHref(context.gameSlug, ref.groupKey, context.hubId)} className={link}
                    data-testid={`lfg-your-hand-other-${ref.groupKey === '' ? 'any' : ref.groupKey}`}>
                    {yourHandLabel(grouping, ref)}
                </Link>
            ))}
        </div>
    );
}

/** The card — nothing without a grouping or without any hand in the game. */
export function LfgYourHandCard(props: LfgYourHandCardProps): JSX.Element | null {
    const others = props.group.ownOtherGroups;
    if (others === undefined) return null;
    const holds = props.group.ownIntent != null;
    if (!holds && others.length === 0) return null;
    const total = others.length + (holds ? 1 : 0);
    return (
        <section data-testid="lfg-your-hand" aria-labelledby="lfg-your-hand-heading" className="space-y-2 rounded-xl bg-surface p-4">
            <h2 id="lfg-your-hand-heading" className="text-sm font-semibold text-foreground">{YOUR_HAND_COPY.heading}</h2>
            <OwnHand {...props} />
            {others.length > 0 && <AlsoIn others={others} context={props.context} grouping={props.grouping} />}
            {total > 1 && <p className="text-xs text-muted">{YOUR_HAND_COPY.separateHands(total)}</p>}
        </section>
    );
}
