import { defineConfig, devices } from '@playwright/test';

const frontendPort = 4173;
const backendPort = 3001;
const frontendUrl = `http://127.0.0.1:${frontendPort}`;
const backendUrl = `http://127.0.0.1:${backendPort}`;

export default defineConfig({
    testDir: './tests/fonctionnels',
    testMatch: '**/*.live.smoke.spec.ts',
    timeout: 120_000,
    expect: {
        timeout: 15_000,
    },
    fullyParallel: false,
    retries: 0,
    reporter: 'list',
    use: {
        baseURL: frontendUrl,
        headless: true,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
    },
    webServer: [
        {
            command: 'npm --prefix backend run dev',
            url: `${backendUrl}/api/health`,
            reuseExistingServer: true,
            timeout: 120_000,
            env: {
                ...process.env,
                PORT: String(backendPort),
                NODE_ENV: 'development',
            },
        },
        {
            command: `npm run dev -- --host 127.0.0.1 --port ${frontendPort}`,
            url: frontendUrl,
            reuseExistingServer: true,
            timeout: 120_000,
            env: {
                ...process.env,
                VITE_API_URL: backendUrl,
            },
        },
    ],
    projects: [
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
            },
        },
    ],
});