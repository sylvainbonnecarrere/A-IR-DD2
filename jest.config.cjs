/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'jsdom',
    roots: ['<rootDir>/services', '<rootDir>/stores', '<rootDir>/utils', '<rootDir>/hooks', '<rootDir>/contexts', '<rootDir>/components', '<rootDir>/tests'],
    testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx', '**/?(*.)+(spec|test).ts', '**/?(*.)+(spec|test).tsx', 'tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
    transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
    },
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
    moduleNameMapper: {
        '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
        '^@/(.*)$': '<rootDir>/$1',
        '^(\\.{1,2}/)+config/api\\.config$': '<rootDir>/tests/mocks/api.config.ts',
    },
    collectCoverageFrom: [
        'services/**/*.ts',
        'stores/**/*.ts',
        'utils/**/*.ts',
        'hooks/**/*.ts',
        'contexts/**/*.tsx',
        'components/**/*.tsx',
        '!**/*.d.ts',
        '!**/__tests__/**',
        '!tests/**',
    ],
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html'],
    verbose: true,
};
