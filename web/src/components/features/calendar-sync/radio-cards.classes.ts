/**
 * NP-2 radio cards (ROK-1595 K4, design-system §4.11): the list `RadioGroup`
 * in a 3-column grid, each option a bordered card; the chosen card wears the
 * full-strength `border-success` ON edge. Shared by `CalendarReadRules` and the
 * `/dev/design-system` gallery so the demo paints the shipped classes.
 */
export const RADIO_CARDS = '[&>div]:grid [&>div]:grid-cols-3 [&>div]:gap-3 [&_label]:rounded-lg [&_label]:border [&_label]:border-edge '
    + '[&_label]:bg-panel [&_label]:px-3 [&_label:has(:checked)]:border-success';
