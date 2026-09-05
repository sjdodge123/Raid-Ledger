/**
 * Minimal ambient declaration for `@m-lab/ndt7` (it ships no types).
 * Only the `test()` entry point `ndt7-runner.ts` calls is described.
 */
declare module '@m-lab/ndt7' {
    const ndt7: {
        test(
            config: Record<string, unknown>,
            callbacks: Record<string, (data: unknown) => void>,
        ): Promise<number>;
    };
    export default ndt7;
}
