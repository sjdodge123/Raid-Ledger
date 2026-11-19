/**
 * Test helper: make Web Storage behave like Safari private mode / blocked
 * site data, where merely touching `localStorage` or `sessionStorage` throws a
 * `SecurityError`. Returns a restore function — call it in `afterEach`.
 */
const AREAS = ['localStorage', 'sessionStorage'] as const;

function throwBlocked(): never {
    throw new DOMException('The operation is insecure.', 'SecurityError');
}

/** Replace both storage getters on `window` and `globalThis` with a throwing getter. */
export function blockWebStorage(): () => void {
    const restores: Array<() => void> = [];
    for (const target of new Set<object>([window, globalThis])) {
        for (const area of AREAS) {
            const original = Object.getOwnPropertyDescriptor(target, area);
            Object.defineProperty(target, area, { configurable: true, get: throwBlocked });
            restores.push(() => {
                if (original) Object.defineProperty(target, area, original);
                else Reflect.deleteProperty(target, area);
            });
        }
    }
    return () => {
        for (const restore of restores.reverse()) restore();
    };
}
