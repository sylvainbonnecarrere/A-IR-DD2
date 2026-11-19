import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests/fonctionnels',
    testMatch: '**/*.semi-e2e.spec.ts',
    timeout: 60_000,
    expect: {
        // Marge de timing pour le premier rendu après chargement dev (compilation Vite à la demande).
        timeout: 30_000,
    },
    fullyParallel: false,
    retries: 0,
    reporter: 'list',
    use: {
        baseURL: 'http://127.0.0.1:4173',
        headless: true,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
    },
    webServer: {
        // --strictPort garantit que le serveur de test sert bien sur 4173
        // et ne bascule jamais silencieusement sur le port 4000 de vite.config.ts.
        command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: true,
        timeout: 120_000,
    },
    projects: [
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
            },
        },
    ],
});