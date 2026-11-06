// Collector status + device-level linked + structured activity events dev-bridge fixtures
// (2026-11-06, additive), imported by gen-companion-dev-bridge-fixtures.mjs.
// Every value is synthetic. Events carry NO free text: the invalid cases
// prove a `message` key and a sentence-shaped `errorCode` are rejected.

const AT = '2026-11-01T18:30:00Z';
const at = (s) => `2026-11-01T18:30:${String(s).padStart(2, '0')}Z`;
const bytes = (v) => Buffer.byteLength(JSON.stringify(v), 'utf8');
const PAGE_MAX = 16_384;
/** The longest code in DEV_BRIDGE_EVENT_ERROR_CODES (companion-dev-bridge-events.schema.ts). */
const LONGEST_ERROR_CODE = 'retired_contract_version';

/** The pre-2026-11-06 row shape (no status / linked): must keep parsing. */
const LEGACY_ROWS = [
    { id: 'wow-ledgerlink', enabled: true, paused: false, lastScanAt: AT, lastUploadAt: null, pending: 1 },
    { id: 'bg3-save', enabled: false, paused: false, lastScanAt: null, lastUploadAt: null, pending: 0, lastError: 'Save folder not found' },
];
const SCREENSHOT = { id: 'bg3-screenshot', enabled: true, paused: false, lastScanAt: AT, lastUploadAt: AT, pending: 0 };
/** A linked device: each row shows its own line. */
const ROWS = [
    { ...LEGACY_ROWS[0], status: 'waiting' },
    { ...LEGACY_ROWS[1], status: 'off' },
    { ...SCREENSHOT, status: 'up-to-date' },
];
/** An unlinked device: every enabled row shows `link-device` (one token per device). */
const UNLINKED_ROWS = [
    { ...LEGACY_ROWS[0], status: 'link-device' },
    { ...LEGACY_ROWS[1], status: 'off' },
    { ...SCREENSHOT, status: 'link-device' },
];

const events = {
    next: 'ZXZlbnRzMg',
    events: [
        { ts: at(0), collectorId: 'wow-ledgerlink', kind: 'scan', count: 3 },
        { ts: at(2), collectorId: 'wow-ledgerlink', kind: 'upload-ok', count: 1, httpStatus: 202 },
        { ts: at(4), collectorId: 'bg3-save', kind: 'upload-rejected', httpStatus: 422, errorCode: 'invalid_payload' },
        { ts: at(6), collectorId: 'bg3-screenshot', kind: 'upload-held', count: 2, httpStatus: 429 },
        { ts: at(8), collectorId: 'wow-ledgerlink', kind: 'link-required', httpStatus: 401 },
        { ts: at(10), collectorId: 'bg3-save', kind: 'error', errorCode: 'other' },
        { ts: at(12), collectorId: 'bg3-save', kind: 'collector-off' },
    ],
};

/** An event with every field at its widest. */
const WIDEST = {
    ts: '2026-11-01T18:30:00.999Z', collectorId: `w${'-'.repeat(63)}`, kind: 'upload-rejected',
    count: 1_000_000, httpStatus: 599, errorCode: LONGEST_ERROR_CODE,
};
const pageOf = (n) => ({ next: 'n'.repeat(128), events: Array.from({ length: n }, () => ({ ...WIDEST })) });
let maxN = 0;
while (bytes(pageOf(maxN + 1)) <= PAGE_MAX) maxN += 1;

export const EVENTS_SIZES = { widest: bytes(WIDEST), maxRows: maxN, page: bytes(pageOf(maxN)) };

export const EVENTS_VALID = {
    collectors: { collectors: ROWS, linked: true },
    'collectors--unlinked': { collectors: UNLINKED_ROWS, linked: false },
    'collectors--without-status': { collectors: LEGACY_ROWS },
    events,
    'events--empty': { events: [], next: null },
    'events--max-page': pageOf(maxN),
};

/** [name, base valid fixture, mutate, expected path, expected code] */
export const EVENTS_CASES = [
    ['collectors--unknown-status', 'collectors', (m) => { m.collectors[0].status = 'syncing'; }, 'collectors.0.status', 'invalid_value'],
    ['collectors--linked-not-boolean', 'collectors', (m) => { m.linked = 'yes'; }, 'linked', 'invalid_type'],
    ['collectors--row-linked', 'collectors', (m) => { m.collectors[0].linked = true; }, 'collectors.0', 'unrecognized_keys'],
    ['events--unknown-error-code', 'events', (m) => { m.events[2].errorCode = 'folder_not_found'; }, 'events.2.errorCode', 'invalid_value'],
    ['events--free-text-message', 'events', (m) => { m.events[0].message = 'Scanned 3 file(s) in the WoW folder'; }, 'events.0', 'unrecognized_keys'],
    ['events--error-code-sentence', 'events', (m) => { m.events[5].errorCode = 'Save folder not found'; }, 'events.5.errorCode', 'invalid_value'],
    ['events--unknown-kind', 'events', (m) => { m.events[0].kind = 'note'; }, 'events.0.kind', 'invalid_value'],
    ['events--http-status-out-of-range', 'events', (m) => { m.events[1].httpStatus = 600; }, 'events.1.httpStatus', 'too_big'],
    ['events--missing-next', 'events', (m) => { delete m.next; }, 'next', 'invalid_type'],
    ['events--over-size', 'events--max-page', (m) => { m.events.push({ ...WIDEST }); }, '', 'custom'],
];
