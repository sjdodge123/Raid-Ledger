/**
 * Capture recent console logs (errors, warnings, and info) from the browser.
 * Hooks into console methods to collect a rolling buffer of log entries.
 */
const MAX_LOG_ENTRIES = 100;
const logBuffer: string[] = [];
let consoleHooked = false;

function hookConsole() {
    if (consoleHooked) return;
    consoleHooked = true;

    const methods = ['error', 'warn', 'info', 'log'] as const;
    for (const method of methods) {
        const original = console[method];
        console[method] = (...args: unknown[]) => {
            const timestamp = new Date().toISOString();
            const text = args
                .map((a) => {
                    if (a instanceof Error) return `${a.name}: ${a.message}`;
                    if (typeof a === 'object') {
                        try {
                            return JSON.stringify(a);
                        } catch {
                            return String(a);
                        }
                    }
                    return String(a);
                })
                .join(' ');
            logBuffer.push(`[${timestamp}] [${method.toUpperCase()}] ${text}`);
            if (logBuffer.length > MAX_LOG_ENTRIES) {
                logBuffer.shift();
            }
            original.apply(console, args);
        };
    }
}

export function getClientLogs(): string {
    return logBuffer.join('\n');
}

// Hook into console as early as possible
hookConsole();
