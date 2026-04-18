import type { JSX } from "react";
import type { CoPlayPartnerDto } from "@raid-ledger/contract";
import { Modal } from "../../../components/ui/modal";
import { PartnerRow } from "./PartnerRow";

interface FrequentlyPlaysWithModalProps {
    partners: CoPlayPartnerDto[];
    isOpen: boolean;
    onClose: () => void;
}

/**
 * Full partner list modal — mirrors `HeartedGamesModal`'s pattern but
 * renders from a pre-loaded array (taste profile already includes up to
 * 10 partners, so we do not need infinite scroll).
 */
export function FrequentlyPlaysWithModal({
    partners,
    isOpen,
    onClose,
}: FrequentlyPlaysWithModalProps): JSX.Element {
    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={`Frequently Plays With (${partners.length})`}
            maxWidth="max-w-md"
        >
            <ul className="frequently-plays-with__modal-list">
                {partners.map((partner) => (
                    <li key={partner.userId}>
                        <PartnerRow partner={partner} />
                    </li>
                ))}
            </ul>
        </Modal>
    );
}
