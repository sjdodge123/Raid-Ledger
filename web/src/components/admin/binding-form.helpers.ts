import type { BindingPurpose, ChannelType } from '@raid-ledger/contract';
import { BINDING_PURPOSE_LABELS } from '@raid-ledger/contract';

/**
 * Purposes a channel of each type may legally carry (ROK-1415 invariant),
 * shared by the create and edit binding forms (TDB:261). The first entry is
 * the default when a channel of that type is picked.
 */
export const PURPOSE_BY_TYPE: Record<ChannelType, readonly BindingPurpose[]> = {
    voice: ['game-voice-monitor', 'general-lobby'],
    text: ['game-announcements'],
    forum: ['lfg-board'],
};

interface PurposeOption {
    value: BindingPurpose;
    label: string;
}

/**
 * Select options per channel type. Labels come from the contract so the
 * `/bind` reply and both forms cannot drift apart (ROK-1462 AC5).
 */
export const PURPOSE_OPTIONS: Record<ChannelType, PurposeOption[]> = {
    voice: toOptions(PURPOSE_BY_TYPE.voice),
    text: toOptions(PURPOSE_BY_TYPE.text),
    forum: toOptions(PURPOSE_BY_TYPE.forum),
};

function toOptions(purposes: readonly BindingPurpose[]): PurposeOption[] {
    return purposes.map((value) => ({ value, label: BINDING_PURPOSE_LABELS[value] }));
}
