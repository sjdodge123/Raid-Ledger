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
    /** The group's bindings, sorted by purpose, then game name, then id. */
    bindings: ChannelBindingDto[];
    /** Source of the channel-level lifecycle chips + Pin (see `pickLifecycleBinding`). */
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

function compareRows(a: ChannelBindingDto, b: ChannelBindingDto): number {
    const byPurpose = a.bindingPurpose.localeCompare(b.bindingPurpose);
    if (byPurpose !== 0) return byPurpose;
    const byGame = (a.gameName ?? '').localeCompare(b.gameName ?? '', undefined, { sensitivity: 'base' });
    if (byGame !== 0) return byGame;
    return a.id.localeCompare(b.id);
}

/**
 * The channel is pinned if ANY of its auto-managed bindings is pinned, so the
 * header shows that one and Unpin PATCHes it; otherwise the first auto-managed
 * binding (Pin PATCHes it). Without this, a channel whose auto bindings
 * disagree would show "Pin" while one of them is pinned.
 */
function pickLifecycleBinding(bindings: readonly ChannelBindingDto[]): ChannelBindingDto | null {
    return bindings.find((x) => x.autoManaged === true && x.pinned === true)
        ?? bindings.find((x) => x.autoManaged === true)
        ?? null;
}

function finishGroup(first: ChannelBindingDto, bindings: ChannelBindingDto[]): ChannelBindingGroup {
    const monitors = bindings.filter((x) => x.bindingPurpose === 'game-voice-monitor').length;
    return {
        key: `${first.channelType}:${first.channelId}`,
        channelId: first.channelId,
        channelType: first.channelType,
        channelName: first.channelName,
        displayName: first.channelName ?? first.channelId,
        bindings: [...bindings].sort(compareRows),
        lifecycleBinding: pickLifecycleBinding(bindings),
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
