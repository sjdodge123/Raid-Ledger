/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.integration\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node16',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          resolvePackageJsonExports: false,
        },
      },
    ],
  },
  moduleNameMapper: {
    '^@raid-ledger/contract$': '<rootDir>/../../packages/contract/src/index.ts',
    '^@raid-ledger/contract/(.*)$': '<rootDir>/../../packages/contract/src/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testEnvironment: 'node',
  // Integration tests need more time due to container startup
  testTimeout: 120_000,
  // Run sequentially — tests share a single Testcontainers instance
  maxWorkers: 1,
  // Force exit after tests complete — Testcontainers resource reaper handles container cleanup
  forceExit: true,
};
