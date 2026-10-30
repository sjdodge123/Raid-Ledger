/**
 * ROK-1960 L1 — error codes for reading a BG3 save in the browser (spec
 * section 7, client and WASM rows). Every failure `parseBg3Save` raises is a
 * `Bg3ParseError`, so the sheet branches on `code`, never on a WASM message.
 */

export type Bg3ParseErrorCode =
    | 'too_large'
    | 'one_save_at_a_time'
    | 'not_a_save'
    | 'unsupported_package'
    | 'corrupt_package'
    | 'missing_save_info'
    | 'invalid_save_info'
    | 'invalid_payload'
    | 'reader_failed';

export class Bg3ParseError extends Error {
    readonly code: Bg3ParseErrorCode;
    /** The first schema issue path (`invalid_payload`), else `null`. */
    readonly detail: string | null;
    constructor(code: Bg3ParseErrorCode, detail: string | null = null) {
        super(code);
        Object.setPrototypeOf(this, Bg3ParseError.prototype);
        this.name = 'Bg3ParseError';
        this.code = code;
        this.detail = detail;
    }
}

/** The WASM reader's typed failure codes (`Bg3SaveError.code`). */
const WASM_CODES: Readonly<Record<string, Bg3ParseErrorCode>> = {
    not_lspk: 'not_a_save',
    unsupported_version: 'not_a_save',
    unsupported_package: 'unsupported_package',
    corrupt_package: 'corrupt_package',
    missing_save_info: 'missing_save_info',
    invalid_save_info: 'invalid_save_info',
};

/**
 * The reader's own `Bg3SaveError` → its section-7 code; anything else (a
 * trap such as `RuntimeError: unreachable` on an allocation failure, or an
 * unknown code) → `null`, which the caller treats as `reader_failed`.
 */
export function wasmErrorCode(error: unknown): Bg3ParseErrorCode | null {
    if (!(error instanceof Error) || error.name !== 'Bg3SaveError') return null;
    const code: unknown = 'code' in error ? error.code : undefined;
    return typeof code === 'string' ? (WASM_CODES[code] ?? null) : null;
}

/** Inline-banner copy for each code (spec section 7). */
export function bg3ParseErrorMessage(error: Bg3ParseError): string {
    switch (error.code) {
        case 'too_large':
            return 'That file is too large to be a BG3 save.';
        case 'one_save_at_a_time':
            return 'Drop one save folder at a time.';
        case 'not_a_save':
            return "This isn't a Baldur's Gate 3 save (.lsv).";
        case 'unsupported_package':
            return "This save is stored in a way we can't read yet. Try a different save.";
        case 'corrupt_package':
            return 'This save file is damaged. Save again in the game and upload the new save.';
        case 'missing_save_info':
            return 'This save is missing its summary.';
        case 'invalid_save_info':
            return "This save's summary is damaged, so it can't be read.";
        case 'invalid_payload':
            return error.detail ? `This save can't be read (${error.detail}).` : "This save can't be read.";
        case 'reader_failed':
            return "Couldn't load the save reader. Reload and try again.";
    }
}
