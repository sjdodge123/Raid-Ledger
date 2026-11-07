/**
 * ROK-2106 — group the admin channel-binding list by Discord channel. Pure,
 * no React: the list renders one card per group, one compact row per binding.
 */
import type { ChannelBindingDto } from '@raid-ledger/contract';

/** One Discord channel (id + kind) and every binding on it. */
export interface ChannelBindingGroup {
    /** Stable React key: `${channelType}:${channelId}`. */
    key: string;
    channelId: string;
    channelType: ChannelBindingDto['channelType'];
    channelName: string | undefined;
    /** `channelName`, falling back to the channel id. */
    displayName: string;
    /** The group's bindings, in the API's order. */
    bindings: ChannelBindingDto[];
    /** First auto-managed binding: source of the channel-level lifecycle chips + Pin. */
    lifecycleBinding: ChannelBindingDto | null;
    /** ≥ 2 game-voice-monitor bindings on this channel. */
    hasMultiMonitor: boolean;
}

const KIND_ORDER: Record<string, number> = { text: 0, voice: 1, forum: 2 };

function compareGroups(a: ChannelBindingGroup, b: ChannelBindingGroup): number {
    const byName = a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
    if (byName !== 0) return byName;
    const byKind = (KIND_ORDER[a.channelType] ?? 9) - (KIND_ORDER[b.channelType] ?? 9);
    if (byKind !== 0) return byKind;
    return a.channelId.localeCompare(b.channelId);
}

function finishGroup(first: ChannelBindingDto, bindings: ChannelBindingDto[]): ChannelBindingGroup {
    const monitors = bindings.filter((x) => x.bindingPurpose === 'game-voice-monitor').length;
    return {
        key: `${first.channelType}:${first.channelId}`,
        channelId: first.channelId,
        channelType: first.channelType,
        channelName: first.channelName,
        displayName: first.channelName ?? first.channelId,
        bindings,
        lifecycleBinding: bindings.find((x) => x.autoManaged === true) ?? null,
        hasMultiMonitor: monitors >= 2,
    };
}

/** Group bindings by channel id + kind, ordered by channel name (text before voice on a tie). */
export function groupBindingsByChannel(bindings: readonly ChannelBindingDto[]): ChannelBindingGroup[] {
    const buckets = new Map<string, ChannelBindingDto[]>();
    for (const binding of bindings) {
        const key = `${binding.channelType}:${binding.channelId}`;
        const bucket = buckets.get(key);
        if (bucket) bucket.push(binding);
        else buckets.set(key, [binding]);
    }
    const groups: ChannelBindingGroup[] = [];
    for (const bucket of buckets.values()) {
        const [first] = bucket;
        if (first) groups.push(finishGroup(first, bucket));
    }
    return groups.sort(compareGroups);
}
