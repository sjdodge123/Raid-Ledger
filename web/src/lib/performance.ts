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

/**
 * Initialize Web Vitals monitoring. Call once after React render.
 */
export function initPerformanceMonitoring() {
    if (typeof PerformanceObserver === 'undefined') return;

    // FCP — First Contentful Paint
    try {
        const fcpObserver = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                if (entry.name === 'first-contentful-paint') {
                    report({ name: 'FCP', value: entry.startTime, rating: rate('FCP', entry.startTime) });
                    fcpObserver.disconnect();
                }
            }
        });
        fcpObserver.observe({ type: 'paint', buffered: true });
    } catch {
        // paint observer not supported
    }

    // LCP — Largest Contentful Paint
    try {
        let lcpValue = 0;
        const lcpObserver = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                lcpValue = entry.startTime;
            }
        });
        lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });

        // Report final LCP when page becomes hidden or after interaction
        const reportLCP = () => {
            if (lcpValue > 0) {
                report({ name: 'LCP', value: lcpValue, rating: rate('LCP', lcpValue) });
            }
            lcpObserver.disconnect();
        };
        addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') reportLCP();
        }, { once: true });
    } catch {
        // LCP observer not supported
    }

    // CLS — Cumulative Layout Shift
    try {
        let clsValue = 0;
        const clsObserver = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                const layoutShift = entry as PerformanceEntry & { hadRecentInput: boolean; value: number };
                if (!layoutShift.hadRecentInput) {
                    clsValue += layoutShift.value;
                }
            }
        });
        clsObserver.observe({ type: 'layout-shift', buffered: true });

        addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                report({ name: 'CLS', value: clsValue, rating: rate('CLS', clsValue) });
                clsObserver.disconnect();
            }
        }, { once: true });
    } catch {
        // layout-shift observer not supported
    }

    // TTFB — Time to First Byte
    try {
        const navObserver = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                const nav = entry as PerformanceNavigationTiming;
                const ttfb = nav.responseStart - nav.requestStart;
                if (ttfb > 0) {
                    report({ name: 'TTFB', value: ttfb, rating: rate('TTFB', ttfb) });
                }
            }
            navObserver.disconnect();
        });
        navObserver.observe({ type: 'navigation', buffered: true });
    } catch {
        // navigation observer not supported
    }
}
