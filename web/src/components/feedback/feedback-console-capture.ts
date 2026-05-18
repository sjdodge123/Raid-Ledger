/**
 * Capture recent console output + uncaught errors from the browser for
 * bug-report attachment. Two split-by-severity buffers (errors/warns and
 * logs/infos) so noisy console.log floods cannot evict the one
 * console.error a triager needs. window.error + unhandledrejection are
 * also captured so uncaught failures show up even when no console.* call
 * preceded them (ROK-1312).
 */
const MAX_ERROR_ENTRIES = 50;
const MAX_LOG_ENTRIES = 50;
const errorBuffer: string[] = [];
const logBuffer: string[] = [];
let consoleHooked = false;

function formatArg(a: unknown): string {
    if (a instanceof Error) return `${a.name}: ${a.message}`;
    if (typeof a === 'object' && a !== null) {
        try {
            return JSON.stringify(a);
        } catch {
            return String(a);
        }
    }
    return String(a);
}

function pushError(entry: string) {
    errorBuffer.push(entry);
    if (errorBuffer.length > MAX_ERROR_ENTRIES) errorBuffer.shift();
}

function pushLog(entry: string) {
    logBuffer.push(entry);
    if (logBuffer.length > MAX_LOG_ENTRIES) logBuffer.shift();
}

function hookConsoleMethod(method: 'error' | 'warn' | 'info' | 'log') {
    const original = console[method];
    console[method] = (...args: unknown[]) => {
        const timestamp = new Date().toISOString();
        const text = args.map(formatArg).join(' ');
        const entry = `[${timestamp}] [${method.toUpperCase()}] ${text}`;
        if (method === 'error' || method === 'warn') pushError(entry);
        else pushLog(entry);
        original.apply(console, args);
    };
}

function formatRejectionReason(reason: unknown): string {
    if (reason instanceof Error) return `${reason.name}: ${reason.message}`;
    if (typeof reason === 'object' && reason !== null) {
        try {
            return JSON.stringify(reason);
        } catch {
            return String(reason);
        }
    }
    return String(reason);
}

function hookWindowErrorEvents() {
    if (typeof window === 'undefined') return;
    window.addEventListener('error', (ev: ErrorEvent) => {
        const ts = new Date().toISOString();
        const loc = ev.filename
            ? ` @ ${ev.filename}:${ev.lineno ?? '?'}:${ev.colno ?? '?'}`
            : '';
        pushError(`[${ts}] [ERROR] uncaught: ${ev.message}${loc}`);
    });
    window.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
        const ts = new Date().toISOString();
        pushError(
            `[${ts}] [ERROR] unhandled rejection: ${formatRejectionReason(ev.reason)}`,
        );
    });
}

function hookConsole() {
    if (consoleHooked) return;
    consoleHooked = true;

    const methods: Array<'error' | 'warn' | 'info' | 'log'> = [
        'error',
        'warn',
        'info',
        'log',
    ];
    for (const method of methods) hookConsoleMethod(method);

    hookWindowErrorEvents();
}

export function getClientLogs(): string {
    return [...errorBuffer, ...logBuffer].join('\n');
}

// Hook into console + window error events as early as possible
hookConsole();
