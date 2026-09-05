/**
 * ROK-1374 scenario 19 — the runner yields a single download figure (Mbps) or
 * nothing at all. There is no auto-run guard to test: every measurement is
 * started by a human (operator ruling 2026-09-05).
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it, expect, vi, afterEach } from 'vitest';
import vendoredWorker from '../../../public/ndt7-download-worker.js?raw';
import { runSpeedTest, SPEED_TEST_TIMEOUT_MS } from './ndt7-runner';

afterEach(() => {
    vi.useRealTimers();
});

describe('runSpeedTest', () => {
    it('resolves the mean client Mbps and discards every other artefact', async () => {
        const test = vi.fn(
            async (
                _config: unknown,
                callbacks: Record<string, (d: unknown) => void>,
            ) => {
                callbacks.downloadMeasurement?.({
                    Source: 'client',
                    Data: { MeanClientMbps: 152.5, ElapsedTime: 3.2 },
                    ServerFQDN: 'mlab-secret.example',
                });
                return 0;
            },
        );
        await expect(
            runSpeedTest(async () => ({ default: { test } })),
        ).resolves.toBe(152.5);
    });

    it('hands every client sample to onSample as it arrives, still only the number', async () => {
        const test = vi.fn(async (_config: unknown, callbacks: { downloadMeasurement?: (d: unknown) => void }) => {
            callbacks.downloadMeasurement?.({ Source: 'client', Data: { MeanClientMbps: 12.5 }, ServerFQDN: 'x' });
            callbacks.downloadMeasurement?.({ Source: 'server', Data: { MeanClientMbps: 999 } });
            callbacks.downloadMeasurement?.({ Source: 'client', Data: { MeanClientMbps: 40.25 } });
            return 0;
        });
        const samples: number[] = [];
        await expect(
            runSpeedTest(async () => ({ default: { test } }), (mbps) => samples.push(mbps)),
        ).resolves.toBe(40.25);
        expect(samples).toEqual([12.5, 40.25]);
    });

    it('runs ONLY the download when the module offers the split entry points — never the upload', async () => {
        const test = vi.fn();
        const urls = Promise.resolve(['wss://ndt.example']);
        const discoverServerURLs = vi.fn(() => urls);
        const downloadTest = vi.fn(
            async (
                _config: unknown,
                callbacks: Record<string, (data: unknown) => void>,
                urlPromise: Promise<unknown>,
            ) => {
                await urlPromise;
                callbacks.downloadMeasurement({
                    Source: 'client',
                    Data: { MeanClientMbps: 87.5 },
                });
                return 0;
            },
        );

        await expect(
            runSpeedTest(async () => ({
                default: { test, discoverServerURLs, downloadTest },
            })),
        ).resolves.toBe(87.5);

        expect(downloadTest).toHaveBeenCalledTimes(1);
        expect(downloadTest.mock.calls[0][2]).toBe(urls);
        expect(test).not.toHaveBeenCalled();
    });

    it('rejects when the module fails to load', async () => {
        await expect(
            runSpeedTest(async () => {
                throw new Error('blocked');
            }),
        ).rejects.toThrow('blocked');
    });

    it('stops at the 5 second cap and keeps the best figure so far', async () => {
        vi.useFakeTimers();
        const test = vi.fn(
            (
                _config: unknown,
                callbacks: Record<string, (d: unknown) => void>,
            ) => {
                callbacks.downloadMeasurement?.({
                    Source: 'client',
                    Data: { MeanClientMbps: 88 },
                });
                return new Promise<number>(() => undefined);
            },
        );
        const promise = runSpeedTest(async () => ({ test }));
        await vi.advanceTimersByTimeAsync(SPEED_TEST_TIMEOUT_MS + 10);
        await expect(promise).resolves.toBe(88);
    });

    it('rejects at the cap when no measurement ever arrived', async () => {
        vi.useFakeTimers();
        const test = vi.fn(() => new Promise<number>(() => undefined));
        const promise = runSpeedTest(async () => ({ test }));
        const assertion = expect(promise).rejects.toThrow(/timed out/i);
        await vi.advanceTimersByTimeAsync(SPEED_TEST_TIMEOUT_MS + 10);
        await assertion;
    });

    it('tells ndt7 where its download worker lives (the library default is a page-relative url this app never serves)', async () => {
        const urls = Promise.resolve(['wss://ndt.example']);
        const discoverServerURLs = vi.fn(() => urls);
        const downloadTest = vi.fn(
            async (
                _config: unknown,
                callbacks: Record<string, (data: unknown) => void>,
            ) => {
                callbacks.downloadMeasurement({
                    Source: 'client',
                    Data: { MeanClientMbps: 12 },
                });
                return 0;
            },
        );

        await expect(
            runSpeedTest(async () => ({
                default: { test: vi.fn(), discoverServerURLs, downloadTest },
            })),
        ).resolves.toBe(12);

        const config = downloadTest.mock.calls[0][0] as Record<string, unknown>;
        expect(typeof config.downloadworkerfile).toBe('string');
        expect(config.downloadworkerfile).not.toBe('');
        expect(discoverServerURLs.mock.calls[0][0]).toBe(config);
    });
});

describe('the vendored ndt7 download worker', () => {
    it('is served from public/ at the url the runner hands the library', async () => {
        const { ndt7DownloadWorkerUrl } = await import('./ndt7-load');
        // Absolute path plus a per-build cache-buster: the worker's CSP travels
        // in its own cached response, so its url must change with every build.
        expect(ndt7DownloadWorkerUrl()).toMatch(/^\/ndt7-download-worker\.js\?v=[A-Za-z0-9._-]+$/);
    });

    it('is byte-identical to the packaged worker below its provenance header', () => {
        const resolve = createRequire(import.meta.url).resolve;
        const packaged = readFileSync(
            resolve('@m-lab/ndt7/src/ndt7-download-worker.js'),
            'utf8',
        );
        expect(vendoredWorker.slice(-packaged.length)).toBe(packaged);
    });
});
