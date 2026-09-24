/**
 * Start Lineup form state (ROK-946 / 1302 / 1444) and its dirty check
 * (ROK-1655), extracted from `start-lineup-modal.tsx`.
 *
 * `useStartLineupForm` owns every editable value of the modal: the plain
 * fields (one object, one `setField`), the match-shape + phase durations
 * (`useDurationState`) and the preset handlers. Applying a preset writes its
 * canonical values; any manual match-shape or duration edit drops the preset
 * back to Custom.
 *
 * `isDirty` compares the current values with a snapshot taken at mount
 * (`useStartLineupDirty`). The default title is time-derived, so the snapshot
 * keeps the title the form actually started with rather than recomputing it.
 * The modal feeds `isDirty` to `useDirtyCloseGuard`.
 */
import { useCallback, useState } from 'react';
import { LINEUP_PRESETS, type PresetKey } from './start-lineup-config';

export interface StartLineupFields {
    title: string;
    description: string;
    channelOverrideId: string;
    visibility: 'public' | 'private';
    inviteeUserIds: number[];
    publicShareEnabled: boolean;
    preset: PresetKey;
    includeSchedulingPhase: boolean;
}

export type SetStartLineupField = <K extends keyof StartLineupFields>(
    key: K,
    value: StartLineupFields[K],
) => void;

const DEFAULT_BUILDING_HOURS = 48;
const DEFAULT_VOTING_HOURS = 24;

function defaultTitle(): string {
    const now = new Date();
    const month = now.toLocaleString('en-US', { month: 'long' });
    return `Lineup — ${month} ${now.getFullYear()}`;
}

function initialFields(): StartLineupFields {
    return {
        title: defaultTitle(),
        description: '',
        channelOverrideId: '',
        // ROK-1065: visibility + invitees.
        visibility: 'public',
        inviteeUserIds: [],
        // ROK-1067: public-share toggle (default ON; forced false for private).
        publicShareEnabled: true,
        // ROK-1302: preset selection + scheduling-phase opt-in (default ON).
        preset: 'custom',
        includeSchedulingPhase: true,
    };
}

export function useDurationState() {
    const [building, setBuilding] = useState<number | ''>('');
    const [voting, setVoting] = useState<number | ''>('');
    const [matchThreshold, setMatchThreshold] = useState<number>(35);
    const [votesPerPlayer, setVotesPerPlayer] = useState<number>(3);
    const [tiebreakerMode, setTiebreakerMode] = useState<
        'bracket' | 'veto' | null
    >('bracket');
    // ROK-1444: null = off (deadline-only advancement), the default.
    const [nominationTargetPct, setNominationTargetPct] = useState<
        number | null
    >(null);
    return {
        building: building === '' ? DEFAULT_BUILDING_HOURS : building,
        voting: voting === '' ? DEFAULT_VOTING_HOURS : voting,
        matchThreshold,
        votesPerPlayer,
        tiebreakerMode,
        nominationTargetPct,
        setNominationTargetPct,
        setBuilding,
        setVoting,
        setMatchThreshold,
        setVotesPerPlayer,
        setTiebreakerMode,
    };
}

export type DurationState = ReturnType<typeof useDurationState>;

type Comparable = string | number | boolean | null | number[];

function sameValue(a: Comparable, b: Comparable): boolean {
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((v, i) => v === b[i]);
    }
    return a === b;
}

/** True while any value differs from the one it had on the first render. */
export function useStartLineupDirty(
    values: Record<string, Comparable>,
): boolean {
    const [snapshot] = useState(values);
    return Object.keys(snapshot).some(
        (key) => !sameValue(snapshot[key], values[key]),
    );
}

function durationValues(d: DurationState): Record<string, Comparable> {
    return {
        building: d.building,
        voting: d.voting,
        matchThreshold: d.matchThreshold,
        votesPerPlayer: d.votesPerPlayer,
        tiebreakerMode: d.tiebreakerMode,
        nominationTargetPct: d.nominationTargetPct,
    };
}

function applyPresetValues(
    key: PresetKey,
    durations: DurationState,
    setField: SetStartLineupField,
): void {
    setField('preset', key);
    if (key === 'custom') return;
    const p = LINEUP_PRESETS[key];
    durations.setMatchThreshold(p.matchThreshold);
    durations.setVotesPerPlayer(p.votesPerPlayer);
    durations.setBuilding(p.buildingDurationHours);
    durations.setVoting(p.votingDurationHours);
}

function usePresetHandlers(
    durations: DurationState,
    setField: SetStartLineupField,
) {
    // Any manual match-shape / duration edit drops the preset back to Custom.
    const manual =
        <T>(set: (v: T) => void) =>
        (v: T): void => {
            set(v);
            setField('preset', 'custom');
        };
    return {
        applyPreset: (key: PresetKey): void =>
            applyPresetValues(key, durations, setField),
        onThreshold: manual<number>(durations.setMatchThreshold),
        onVotes: manual<number>(durations.setVotesPerPlayer),
        onBuilding: manual<number | ''>(durations.setBuilding),
        onVoting: manual<number | ''>(durations.setVoting),
    };
}

/** See file docstring. */
export function useStartLineupForm() {
    const durations = useDurationState();
    const [fields, setFields] = useState<StartLineupFields>(initialFields);
    const setField = useCallback<SetStartLineupField>(
        (key, value) => setFields((prev) => ({ ...prev, [key]: value })),
        [],
    );
    const handlers = usePresetHandlers(durations, setField);
    const isDirty = useStartLineupDirty({
        ...fields,
        ...durationValues(durations),
    });
    return { fields, setField, durations, ...handlers, isDirty };
}

export type StartLineupForm = ReturnType<typeof useStartLineupForm>;
