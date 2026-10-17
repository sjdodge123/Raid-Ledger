/**
 * Coarse block presets for the phone inspector (ROK-1579, approved frame 3).
 *
 * The steppers move one hour per tap — an all-day Saturday is sixteen of them.
 * A preset is the same edit expressed as a range, applied through the SAME
 * bounds model (`useBlockEditor::setBounds`), so it can no more cross a
 * committed hour than a stepper can.
 *
 * `endHour` is the DISPLAYED end, matching the inspector's End stepper: a block
 * labelled "5 PM – 1 AM" covers 5 PM through midnight inclusive.
 */
export interface BlockPreset {
    label: string;
    startHour: number;
    /** Exclusive, and shown as-is — the hour the block ends AT. */
    endHour: number;
    testId: string;
}

/** The profile drawer's two: the evening, and the whole editable day. */
export const PROFILE_BLOCK_PRESETS: BlockPreset[] = [
    { label: 'Evening', startHour: 17, endHour: 1, testId: 'phone-block-preset-evening' },
    { label: 'Whole day', startHour: 9, endHour: 1, testId: 'phone-block-preset-whole-day' },
];

/** How a mount hands presets to the editor, and hears back about the window. */
export interface BlockPresetControl {
    list: BlockPreset[];
    /** A preset parked until the window shows its start hour. */
    pending: BlockPreset | null;
    /** The window does not reach this preset — make room, then it retries. */
    onNeedsRoom: (preset: BlockPreset) => void;
    /** The parked preset landed. */
    onApplied: () => void;
}

/**
 * A preset's range in visible-hour index space, or `null` when the window does
 * not show its start hour (the caller then makes room and retries).
 *
 * @param hours The hours currently rendered, in order.
 * @param preset The preset to resolve.
 */
export function presetIndices(hours: number[], preset: BlockPreset): { start: number; end: number } | null {
    const start = hours.indexOf(preset.startHour);
    if (start < 0) return null;
    const endAt = hours.indexOf(preset.endHour);
    // An end hour past the last visible row means "to the end of the day".
    const end = endAt > start ? endAt : hours.length;
    return end > start ? { start, end } : null;
}
