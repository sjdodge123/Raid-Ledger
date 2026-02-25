/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    moduleFileExtensions: ['js', 'json', 'ts'],
    rootDir: 'src',
    testRegex: '.*\\.spec\\.ts$',
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
        // Handle .js extensions in ESM imports
        '^(\\.{1,2}/.*)\\.js$': '$1',
    },
    collectCoverageFrom: [
        '**/*.ts',
        '!**/*.spec.ts',
        '!**/*.module.ts',
        '!main.ts',
        '!drizzle/migrations/**',
    ],
    coverageDirectory: '../coverage',
    coverageThreshold: {
        global: { branches: 40, functions: 38, lines: 45, statements: 45 },
    },
    testEnvironment: 'node',
};
