/**
 * ROK-1927 (W13) — the per-member Attunements detail (spec §5.2, §7, mockup
 * F6), opened by the card's "See who" through `attunements-detail-store.ts`:
 * `Modal max-w-2xl` at ≥1024px, `BottomSheet 85vh` below (§4.4). Attunement
 * tabs are a `FilterChip` group (exactly one pressed); the rows reuse the
 * roster-insights query the card already loaded. Default export for `React.lazy`.
 */
import { useId, useState, type JSX, type ReactNode } from 'react';
import type { WowRosterAttunementsDto } from '@raid-ledger/contract';
import { Modal } from '../../../components/ui/modal';
import { BottomSheet } from '../../../components/ui/bottom-sheet';
import { FilterChip } from '../../../components/ui/filter-chip';
import { QuietEmpty } from '../../../components/hub/card-bits';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { MATRIX_MQ } from './dungeon-quests.helpers';
import { ATTUNEMENTS_UNVERIFIED_COPY } from './attunements.helpers';
import { attunementRows, attunementTabs, type AttunementTab } from './attunement-detail.helpers';
import { AttunementRows } from './attunement-rows';
import { useRosterInsights } from './use-roster-insights';

export const DETAIL_TITLE = 'Attunements';

interface DetailProps { guildId: number; onClose: () => void }

function DetailOverlay({ onClose, children }: { onClose: () => void; children: ReactNode }): JSX.Element {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const shared = { isOpen: true, title: DETAIL_TITLE, onClose, children };
    return isDesktop ? <Modal {...shared} maxWidth="max-w-2xl" /> : <BottomSheet {...shared} maxHeight="85vh" />;
}

function Loading(): JSX.Element {
    return (
        <div data-testid="attunements-detail-loading" className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => <div key={i} className="h-11 animate-pulse rounded-md bg-panel" />)}
        </div>
    );
}

interface TabsProps { tabs: readonly AttunementTab[]; selected: string; onSelect: (key: string) => void; controls: string }

function Tabs({ tabs, selected, onSelect, controls }: TabsProps): JSX.Element {
    return (
        <div role="group" aria-label="Choose an attunement" className="mb-3 flex flex-wrap gap-2">
            {tabs.map((tab) => (
                <FilterChip key={tab.groupKey} label={tab.instance} pressed={tab.groupKey === selected} controls={controls}
                    testId={`attunement-tab-${tab.groupKey}`} onPressedChange={() => onSelect(tab.groupKey)} />
            ))}
        </div>
    );
}

function Loaded({ section }: { section: WowRosterAttunementsDto }): JSX.Element {
    const wide = useMediaQuery(MATRIX_MQ);
    const tabs = attunementTabs(section.attunements);
    const [picked, setPicked] = useState<string | null>(null);
    const listId = useId();
    const tab = tabs.find((t) => t.groupKey === picked) ?? tabs[0];
    if (tab === undefined) return <QuietEmpty testId="attunements-detail-unverified">{ATTUNEMENTS_UNVERIFIED_COPY}</QuietEmpty>;
    return (
        <div data-testid="attunements-detail">
            <Tabs tabs={tabs} selected={tab.groupKey} onSelect={setPicked} controls={listId} />
            {/* Keyed by tab so the "N more" disclosure folds again on a tab switch. */}
            <AttunementRows key={tab.groupKey} rows={attunementRows(tab, section.members)} wide={wide} listId={listId}
                label={`${tab.instance} attunement by member`} />
        </div>
    );
}

function DetailBody({ guildId }: { guildId: number }): JSX.Element | null {
    const { data, isPending, isError } = useRosterInsights(guildId, false);
    if (isPending) return <Loading />;
    if (isError) return <p role="alert" className="text-sm text-muted">Couldn't load attunements.</p>;
    if (data.attunements === undefined) return null;
    return <Loaded section={data.attunements} />;
}

/** The detail overlay for one hub; `onClose` is the store's `close`. */
export default function AttunementsDetail({ guildId, onClose }: DetailProps): JSX.Element {
    return (
        <DetailOverlay onClose={onClose}>
            <DetailBody guildId={guildId} />
        </DetailOverlay>
    );
}
