// ============================================================
// Companion dev bridge v1 — probe function allowlist (ROK-2055 §5.1, D2).
// `packages/contract/companion/dev-bridge/v1/allowlist.json` is GENERATED from
// `DEV_BRIDGE_PROBE_ALLOWLIST` (scripts/gen-companion-schemas.mjs). rl-companion
// (on POST /dev/v1/probes) and the LedgerLinkProbe addon (before each call)
// pin that file and apply the SAME table; its `examples` are the shared test
// vectors. The deny rules always win over the allow rules.
// ============================================================

/** How a path segment is split into words for the deny check (normative; mirrors `devBridgeSegmentWords`). */
const TOKENIZER_RULE =
    'Split the segment at every "_". Inside each piece start a new word before an uppercase letter that follows a lowercase letter or a digit, and before an uppercase letter that is followed by a lowercase letter and preceded by an uppercase letter. Drop empty words. Deny words, deny pairs and deny-exact names compare case-insensitively; allow prefixes and allow-exact names compare case-sensitively.';

/** Whole camel-case words that refuse a path wherever they appear (case-insensitive). */
const DENY_WORDS = [
    'send', 'set', 'delete', 'destroy', 'buy', 'sell', 'accept', 'decline', 'confirm', 'use', 'cast',
    'pickup', 'place', 'drop', 'repair', 'learn', 'unlearn', 'abandon', 'leave', 'invite', 'uninvite',
    'promote', 'demote', 'kick', 'run', 'load', 'reload', 'logout', 'quit', 'create', 'hook', 'register',
    'secure', 'macro', 'chat', 'mail', 'auction', 'trade', 'getfenv', 'setfenv', 'rawset', 'loadstring',
    'pcall', 'cancel', 'clear', 'remove', 'reset', 'toggle', 'equip', 'disband',
] as const;

/** `send` → `GetSendInfo`: a read-prefixed name only the deny word can refuse. */
const denyWordVector = (word: string): string => `Get${word.charAt(0).toUpperCase()}${word.slice(1)}Info`;

/** The shared allowlist table (serialised verbatim into `allowlist.json`). */
export const DEV_BRIDGE_PROBE_ALLOWLIST = {
    allowlistVersion: 1,
    segmentPattern: '^[A-Za-z_][A-Za-z0-9_]*$',
    maxSegments: 3,
    tokenizer: TOKENIZER_RULE,
    /** The FIRST word of the LAST segment must equal one of these (case-sensitive) and that segment must hold no "_"… */
    allowPrefixes: ['Get', 'Is', 'Has', 'Can', 'Unit', 'Num'],
    /** …or the WHOLE path must equal one of these (case-sensitive). */
    allowExact: ['InCombatLockdown', 'time', 'date'],
    /** Denied when ANY word of ANY segment equals one of these (case-insensitive). */
    denyWords: DENY_WORDS,
    /** Denied when one segment holds BOTH words of a pair (case-insensitive). */
    denyWordPairs: [
        ['guild', 'set'],
        ['guild', 'remove'],
        ['guild', 'disband'],
        ['guild', 'promote'],
    ],
    /** Read-prefixed functions that change state anyway; denied when ANY segment equals one (case-insensitive). */
    denyExact: ['GetQuestReward', 'GetInboxText'],
    /** Return slots (1-based Lua return index) replaced by `replacement` before a result is stored. */
    redact: [{ fn: 'GetGuildRosterInfo', returns: [8], replacement: '<redacted>' }],
    /** Shared test vectors: every implementation must agree on each verdict. */
    examples: {
        allowed: [
            'GetProfessions', 'GetNumSkillLines', 'GetSkillLineInfo', 'GetCVar', 'IsInGuild', 'IsAddOnLoaded',
            'C_AddOns.IsAddOnLoaded', 'UnitName', 'UnitGUID', 'GetNumAddOns', 'GetGuildRosterInfo',
            'InCombatLockdown', 'UnitCastingInfo', 'C_Map.GetBestMapForUnit', 'GetSavedInstanceInfo',
        ],
        denied: [
            'SendChatMessage', 'SetCVar', 'loadstring', 'getfenv', 'RunScript', 'GuildUninvite',
            'C_Container.UseContainerItem', 'GetQuestReward', 'CancelUnitBuff', 'DoEmote', 'GuildSetMOTD',
            'C_ChatInfo.GetRegisteredAddonMessagePrefixes', 'GetTradeSkillLine', 'C_GuildInfo.RemoveFromGuild',
            'UnitSetRole', 'A.B.C.GetMoney', '1Get', 'Get-Money', 'Get..Money',
            'UnitPopup_OnClick', 'UnitFrame_OnEvent', 'UnitPopup_ShowMenu', 'SomeAddon.time',
        ],
        /** Read-prefixed, so ONLY the deny rules refuse them: one per deny word and deny-exact name. */
        denyListed: [
            'GetSendMailItem', 'UnitSetRole', 'GetQuestReward', 'GetInboxText', 'C_GuildInfo.GetGuildDisbandInfo',
            'GetTradeSkillLine', 'C_ChatInfo.GetRegisteredAddonMessagePrefixes', 'GetMacroInfo',
            'GetAuctionItemInfo', 'CanGuildInvite', 'IsAddOnLoadOnDemand',
            ...DENY_WORDS.map(denyWordVector),
        ],
        /** Tokenizer vectors: `segment` must split into exactly `words`. */
        tokenizer: [
            { segment: 'GetCVar', words: ['Get', 'C', 'Var'] },
            { segment: 'IsAddOnLoaded', words: ['Is', 'Add', 'On', 'Loaded'] },
            { segment: 'C_TradeSkillUI', words: ['C', 'Trade', 'Skill', 'UI'] },
            { segment: 'GUIDSetThing', words: ['GUID', 'Set', 'Thing'] },
            { segment: 'UnitIsAFK', words: ['Unit', 'Is', 'AFK'] },
            { segment: 'GetHTTPResponse2Code', words: ['Get', 'HTTP', 'Response2', 'Code'] },
            { segment: 'Get2Money', words: ['Get2', 'Money'] },
            { segment: 'Get2FA', words: ['Get2', 'FA'] },
            { segment: 'UnitPopup_OnClick', words: ['Unit', 'Popup', 'On', 'Click'] },
            { segment: '__index', words: ['index'] },
            { segment: 'loadstring', words: ['loadstring'] },
        ],
    },
} as const;

/** Why a probe function path was refused (empty when allowed). */
export type DevBridgeFunctionVerdict =
    | { readonly allowed: true }
    | { readonly allowed: false; readonly reason: 'grammar' | 'not_read_verb' | 'denied' };

const SEGMENT_RE = new RegExp(DEV_BRIDGE_PROBE_ALLOWLIST.segmentPattern);

/** Split one path segment into words per `TOKENIZER_RULE`. */
export function devBridgeSegmentWords(segment: string): string[] {
    return segment
        .split('_')
        .flatMap((piece) =>
            piece
                .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
                .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
                .split(' '),
        )
        .filter((w) => w.length > 0);
}

/** True when the dotted path is 1..maxSegments segments, each matching `segmentPattern`. */
export function isDevBridgePathGrammatical(path: string): boolean {
    const segments = path.split('.');
    return segments.length <= DEV_BRIDGE_PROBE_ALLOWLIST.maxSegments && segments.every((s) => SEGMENT_RE.test(s));
}

const has = (list: readonly string[], value: string): boolean => list.includes(value);

/** Deny rules: any segment's words hit a deny word or pair, or a segment equals a deny-exact name. */
function isDenied(segments: readonly string[]): boolean {
    const exact = DEV_BRIDGE_PROBE_ALLOWLIST.denyExact.map((n) => n.toLowerCase());
    return segments.some((segment) => {
        if (has(exact, segment.toLowerCase())) return true;
        const words = devBridgeSegmentWords(segment).map((w) => w.toLowerCase());
        if (words.some((w) => has(DEV_BRIDGE_PROBE_ALLOWLIST.denyWords, w))) return true;
        return DEV_BRIDGE_PROBE_ALLOWLIST.denyWordPairs.some(([a, b]) => has(words, a) && has(words, b));
    });
}

/**
 * Allow rules alone (no deny check): the whole path is allow-exact, or the last
 * segment's first word is a read prefix AND that segment holds no "_" (real C API
 * leaf names never do; FrameXML handlers like `UnitPopup_OnClick` always do).
 */
export function isDevBridgeReadVerb(path: string): boolean {
    if (has(DEV_BRIDGE_PROBE_ALLOWLIST.allowExact, path)) return true;
    const last = path.split('.').pop() ?? '';
    if (last.includes('_')) return false;
    const first = devBridgeSegmentWords(last)[0];
    return first !== undefined && has(DEV_BRIDGE_PROBE_ALLOWLIST.allowPrefixes, first);
}

/** Verdict for one probe `fn` path. Deny wins over allow. */
export function checkDevBridgeProbeFunction(path: string): DevBridgeFunctionVerdict {
    if (!isDevBridgePathGrammatical(path)) return { allowed: false, reason: 'grammar' };
    const segments = path.split('.');
    if (isDenied(segments)) return { allowed: false, reason: 'denied' };
    if (!isDevBridgeReadVerb(path)) return { allowed: false, reason: 'not_read_verb' };
    return { allowed: true };
}

/** Exact file contents of `companion/dev-bridge/v1/allowlist.json` (2-space indent, trailing newline). */
export function serializeDevBridgeAllowlist(): string {
    return `${JSON.stringify(DEV_BRIDGE_PROBE_ALLOWLIST, null, 2)}\n`;
}
