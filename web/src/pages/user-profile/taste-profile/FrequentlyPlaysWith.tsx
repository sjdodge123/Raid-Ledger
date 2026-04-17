import type { JSX } from "react";
import { useState } from "react";
import type { CoPlayPartnerDto } from "@raid-ledger/contract";
import { PartnerRow } from "./PartnerRow";
import { FrequentlyPlaysWithModal } from "./FrequentlyPlaysWithModal";

interface FrequentlyPlaysWithProps {
    partners: CoPlayPartnerDto[];
}

function PartnerPreviewList({
    partners,
}: {
    partners: CoPlayPartnerDto[];
}): JSX.Element {
    return (
        <ul className="frequently-plays-with__list">
            {partners.map((partner) => (
                <li key={partner.userId}>
                    <PartnerRow partner={partner} />
                </li>
            ))}
        </ul>
    );
}

/**
 * Shows the user's top 3 co-play partners inline; renders a "Show all
 * (N)" button when there are more than 3 that opens a modal listing
 * every partner. Hides itself entirely when the list is empty.
 */
export function FrequentlyPlaysWith({
    partners,
}: FrequentlyPlaysWithProps): JSX.Element | null {
    const [isModalOpen, setIsModalOpen] = useState(false);
    if (partners.length === 0) return null;
    const total = partners.length;
    return (
        <div className="frequently-plays-with">
            <h3 className="frequently-plays-with__title">
                Frequently Plays With
            </h3>
            <PartnerPreviewList partners={partners.slice(0, 3)} />
            {total > 3 && (
                <button
                    type="button"
                    onClick={() => setIsModalOpen(true)}
                    className="frequently-plays-with__show-all"
                >
                    Show all ({total})
                </button>
            )}
            <FrequentlyPlaysWithModal
                partners={partners}
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
            />
        </div>
    );
}
