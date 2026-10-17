/**
 * Web Vitals monitoring using native PerformanceObserver API.
 * Tracks FCP, LCP, CLS, and navigation timing without external dependencies.
 *
 * ROK-343: Performance targets — FCP <1.8s, LCP <2.5s.
 */

type MetricName = 'FCP' | 'LCP' | 'CLS' | 'TTFB';

interface WebVitalMetric {
    name: MetricName;
    value: number;
    rating: 'good' | 'needs-improvement' | 'poor';
}

const thresholds: Record<MetricName, [number, number]> = {
    FCP: [1800, 3000],
    LCP: [2500, 4000],
    CLS: [0.1, 0.25],
    TTFB: [800, 1800],
};

function rate(name: MetricName, value: number): WebVitalMetric['rating'] {
    const [good, poor] = thresholds[name];
    if (value <= good) return 'good';
    if (value <= poor) return 'needs-improvement';
    return 'poor';
}

function report(metric: WebVitalMetric) {
    if (import.meta.env.DEV) {
        const color = metric.rating === 'good' ? '#0cce6b'
            : metric.rating === 'needs-improvement' ? '#ffa400'
            : '#ff4e42';
        const unit = metric.name === 'CLS' ? '' : 'ms';
        const value = metric.name === 'CLS' ? metric.value.toFixed(3) : Math.round(metric.value);
        console.log(
            `%c[Web Vitals] ${metric.name}: ${value}${unit} (${metric.rating})`,
            `color: ${color}; font-weight: bold`,
        );
    }
}

function observeFCP(): void {
    try {
        const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                if (entry.name === 'first-contentful-paint') {
                    report({ name: 'FCP', value: entry.startTime, rating: rate('FCP', entry.startTime) });
                    observer.disconnect();
                }
            }
        });
        observer.observe({ type: 'paint', buffered: true });
    } catch { /* not supported */ }
}

function observeLCP(): void {
    try {
        let lcpValue = 0;
        const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) lcpValue = entry.startTime;
        });
        observer.observe({ type: 'largest-contentful-paint', buffered: true });
        addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                if (lcpValue > 0) report({ name: 'LCP', value: lcpValue, rating: rate('LCP', lcpValue) });
                observer.disconnect();
            }
        }, { once: true });
    } catch { /* not supported */ }
}

function observeCLS(): void {
    try {
        let clsValue = 0;
        const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                const shift = entry as PerformanceEntry & { hadRecentInput: boolean; value: number };
                if (!shift.hadRecentInput) clsValue += shift.value;
            }
        });
        observer.observe({ type: 'layout-shift', buffered: true });
        addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                report({ name: 'CLS', value: clsValue, rating: rate('CLS', clsValue) });
                observer.disconnect();
            }
        }, { once: true });
    } catch { /* not supported */ }
}

function observeTTFB(): void {
    try {
        const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                const nav = entry as PerformanceNavigationTiming;
                const ttfb = nav.responseStart - nav.requestStart;
                if (ttfb > 0) report({ name: 'TTFB', value: ttfb, rating: rate('TTFB', ttfb) });
            }
            observer.disconnect();
        });
        observer.observe({ type: 'navigation', buffered: true });
    } catch { /* not supported */ }
}

/**
 * Initialize Web Vitals monitoring. Call once after React render.
 */
export function initPerformanceMonitoring() {
    if (typeof PerformanceObserver === 'undefined') return;
    observeFCP();
    observeLCP();
    observeCLS();
    observeTTFB();
}
