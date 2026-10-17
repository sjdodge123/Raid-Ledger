/**
 * ROK-1785/ROK-1830 — the Members (Roster) tab frame: a titled card holding
 * the module's summary band and its member groups, each a collapsible list of
 * rows. Core owns the frame and the collapse behaviour; the hub module says
 * how rows group (WoW: by guild rank) and what each row's cells are.
 */
import type { JSX } from 'react';
import type { GuildPage } from '@raid-ledger/contract';
import type { HubCtx, HubMemberColumn, HubMemberGroup, HubModule } from '../../plugins/hub-module';
import { ScrollCollapsible } from '../ui/scroll-collapsible';
import { Card, SectionTitle } from './hub-bits';

interface GroupProps {
    group: HubMemberGroup;
    columns: readonly HubMemberColumn[];
    rowClass: ((row: HubMemberGroup['rows'][number]) => string) | undefined;
}

function MemberGroup({ group, columns, rowClass }: GroupProps): JSX.Element {
    return (
        <div data-testid={group.testId}>
            <ScrollCollapsible title={`${group.label} · ${group.rows.length}`} defaultOpen={group.defaultOpen}
                className="border-b border-edge py-2 last:border-b-0">
                <ul aria-label={`${group.label} members`} className="flex flex-col gap-1 text-sm">
                    {group.rows.map((row) => (
                        <li key={row.memberId} data-testid="guild-roster-member"
                            className={`flex flex-wrap items-center gap-x-2 gap-y-1 border-l-2 py-1 pl-2 ${rowClass ? rowClass(row) : 'border-edge-subtle'}`}>
                            {columns.map((c) => <c.cell key={c.id} row={row} />)}
                        </li>
                    ))}
                </ul>
            </ScrollCollapsible>
        </div>
    );
}

export function HubMembers({ ctx, module: mod }: { ctx: HubCtx; module: HubModule | undefined }): JSX.Element {
    const page: GuildPage = ctx.page;
    const groups = (mod?.memberGroups(page) ?? []).filter((g) => g.rows.length > 0);
    const Summary = mod?.membersSummary;
    return (
        <section id="members" className="scroll-mt-4" data-testid="guild-roster">
            <SectionTitle title="Members" blurb={mod?.membersBlurb?.(page) ?? `${page.guild.memberCount} members`} />
            <Card className="flex flex-col gap-3">
                {Summary && <Summary {...ctx} />}
                {groups.length === 0
                    ? <p className="py-6 text-center text-sm text-muted">{mod?.membersEmpty ?? 'No members yet.'}</p>
                    : <div>{groups.map((g) => <MemberGroup key={g.key} group={g} columns={mod?.memberColumns ?? []} rowClass={mod?.memberRowClass} />)}</div>}
            </Card>
        </section>
    );
}
