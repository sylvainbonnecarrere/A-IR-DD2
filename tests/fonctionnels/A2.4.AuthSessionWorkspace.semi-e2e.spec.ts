import { expect, test, type Page, type Route } from '@playwright/test';

const workflowId = '64f00000000000000000a240';
const now = '2026-04-27T12:00:00.000Z';
const guestWorkflowStorageKey = 'guest_workflow_v1';

type RouteResponse = {
    status: number;
    body: unknown;
    delayMs?: number;
};

type MockScenarioState = {
    workspaceRequests: number;
    workflowRequests: number;
    refreshRequests: number;
    latestAccessToken: string | null;
    loginAccessToken: string;
    refreshToken: string;
    userId: string;
    userEmail: string;
    failWorkflowOnceForToken?: string;
    requireFreshWorkspaceToken?: boolean;
    workspaceRefreshToken?: string;
    refreshDelayMs?: number;
};

function createWorkspacePayload(agentName: string) {
    return {
        workflow: {
            id: workflowId,
            _id: workflowId,
            name: 'Workflow A2.4 Session Stable',
            description: 'Validation semi-E2E hydration session stable',
            isActive: true,
            isDefault: true,
            isDirty: false,
            canvasState: { zoom: 1, panX: 0, panY: 0 },
            createdAt: now,
            updatedAt: now,
        },
        nodes: [],
        edges: [],
        agentPrototypes: [
            {
                id: 'prototype-a24-1',
                name: agentName,
                role: 'assistant',
                description: 'Persistent workflow agent',
                systemPrompt: 'Remain visible during auth refreshes',
                provider: 'gemini',
                model: 'gemini-2.0-flash',
                capabilities: [],
                tools: [],
                toolSelections: [],
                created_at: now,
                updated_at: now,
            },
        ],
        agentInstances: [
            {
                id: 'instance-a24-1',
                prototypeId: 'prototype-a24-1',
                workflowId,
                name: agentName,
                position: { x: 180, y: 120 },
                isMinimized: false,
                isMaximized: false,
                configuration_json: {
                    role: 'assistant',
                    model: 'gemini-2.0-flash',
                    llmProvider: 'gemini',
                    systemPrompt: 'Remain visible during auth refreshes',
                    capabilities: [],
                    tools: [],
                    toolSelections: [],
                    historyConfig: {},
                    outputConfig: {},
                    position: { x: 180, y: 120 },
                },
                chatMessages: [
                    {
                        sender: 'agent',
                        text: `Hydrated ${agentName}`,
                        timestamp: now,
                    },
                ],
            },
        ],
        llmConfigs: [],
        toolRuns: [],
        metadata: {
            userId: 'user-a24',
            source: 'api',
            loadedAt: now,
            hasWorkflow: true,
        },
    };
}

async function fulfillJson(route: Route, response: RouteResponse) {
    if (response.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, response.delayMs));
    }

    await route.fulfill({
        status: response.status,
        contentType: 'application/json',
        body: JSON.stringify(response.body),
        headers: {
            'access-control-allow-origin': '*',
        },
    });
}

async function bootstrapGuestSession(page: Page, withGuestWorkflow = false) {
    await page.addInitScript(({ withGuestWorkflow, guestWorkflowStorageKey }) => {
        localStorage.removeItem('auth_data_v1');

        if (withGuestWorkflow) {
            localStorage.setItem(guestWorkflowStorageKey, JSON.stringify({
                id: 'guest-workflow-before-login',
                name: 'Guest Workflow Before Login',
                canvasState: { zoom: 1, panX: 0, panY: 0 },
            }));
        }
    }, { withGuestWorkflow, guestWorkflowStorageKey });
}

async function bootstrapAuthenticatedSession(page: Page, state: MockScenarioState) {
    await page.addInitScript(({ loginAccessToken, refreshToken, userId, userEmail }) => {
        localStorage.setItem('auth_data_v1', JSON.stringify({
            user: {
                id: userId,
                email: userEmail,
                role: 'user',
            },
            accessToken: loginAccessToken,
            refreshToken,
        }));
    }, {
        loginAccessToken: state.loginAccessToken,
        refreshToken: state.refreshToken,
        userId: state.userId,
        userEmail: state.userEmail,
    });
}

async function installAuthWorkspaceMocks(page: Page, state: MockScenarioState, agentName: string) {
    const workspacePayload = createWorkspacePayload(agentName);

    await page.route('**/api/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const path = url.pathname;
        const method = request.method();
        const authHeader = request.headers()['authorization'] || '';
        const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

        if (path === '/api/auth/login' && method === 'POST') {
            state.latestAccessToken = state.loginAccessToken;
            return fulfillJson(route, {
                status: 200,
                body: {
                    user: {
                        id: state.userId,
                        email: state.userEmail,
                        role: 'user',
                    },
                    accessToken: state.loginAccessToken,
                    refreshToken: state.refreshToken,
                },
            });
        }

        if (path === '/api/auth/refresh' && method === 'POST') {
            state.refreshRequests += 1;
            state.latestAccessToken = state.workspaceRefreshToken || 'refreshed-access-token';
            return fulfillJson(route, {
                status: 200,
                delayMs: state.refreshDelayMs,
                body: {
                    accessToken: state.latestAccessToken,
                },
            });
        }

        if (path === '/api/llm/get-all-api-keys' && method === 'POST') {
            return fulfillJson(route, { status: 200, body: [] });
        }

        if (path === '/api/local-llm-profiles' && method === 'GET') {
            return fulfillJson(route, { status: 200, body: [] });
        }

        if (path === '/api/user/workspace' && method === 'GET') {
            state.workspaceRequests += 1;

            if (state.requireFreshWorkspaceToken && bearerToken !== state.workspaceRefreshToken) {
                return fulfillJson(route, {
                    status: 401,
                    body: { error: 'Token expired after sleep' },
                });
            }

            return fulfillJson(route, {
                status: 200,
                body: workspacePayload,
            });
        }

        if (path === '/api/workflows' && method === 'GET') {
            state.workflowRequests += 1;

            if (state.failWorkflowOnceForToken && bearerToken === state.failWorkflowOnceForToken) {
                state.failWorkflowOnceForToken = undefined;
                return fulfillJson(route, {
                    status: 401,
                    body: { error: 'Expired token on workflow list' },
                });
            }

            return fulfillJson(route, {
                status: 200,
                body: {
                    workflows: [
                        {
                            _id: workflowId,
                            userId: state.userId,
                            name: 'Workflow A2.4 Session Stable',
                            description: 'Validation semi-E2E hydration session stable',
                            isActive: true,
                            isDefault: true,
                            createdAt: now,
                            updatedAt: now,
                            agentCount: 1,
                        },
                    ],
                },
            });
        }

        if (path === '/api/sandbox/health' && method === 'GET') {
            return fulfillJson(route, {
                status: 200,
                body: {
                    status: 'healthy',
                    summary: 'Runtime mocked for A2.4 session tests',
                    checkedAt: now,
                },
            });
        }

        if (path === '/api/runs' && method === 'GET') {
            return fulfillJson(route, {
                status: 200,
                body: {
                    items: [],
                    pagination: {
                        page: 1,
                        limit: 20,
                        total: 0,
                        totalPages: 1,
                        sortBy: 'createdAt',
                        sortOrder: 'desc',
                    },
                },
            });
        }

        if (path === '/api/tools' && method === 'GET') {
            return fulfillJson(route, {
                status: 200,
                body: { items: [] },
            });
        }

        return fulfillJson(route, {
            status: 404,
            body: { error: `Unhandled API route in A2.4 semi-E2E: ${method} ${path}` },
        });
    });
}

async function openAppAndWaitForAgent(page: Page, agentName: string) {
    await page.goto('/');
    await expect(page.getByText(agentName, { exact: true }).first()).toBeVisible();
}

async function expectAgentNeverDisappears(page: Page, agentName: string, samples = 6, delayMs = 150) {
    const locator = page.getByText(agentName, { exact: true }).first();

    for (let index = 0; index < samples; index += 1) {
        await expect(locator).toBeVisible();
        await page.waitForTimeout(delayMs);
    }
}

test.describe('A2.4 semi-E2E navigateur réel — session workspace stable', () => {
    test('login hydrate le workspace authentifie et purge les donnees guest', async ({ page }) => {
        const state: MockScenarioState = {
            workspaceRequests: 0,
            workflowRequests: 0,
            refreshRequests: 0,
            latestAccessToken: null,
            loginAccessToken: 'login-access-token',
            refreshToken: 'login-refresh-token',
            userId: 'user-a24-login',
            userEmail: 'a24-login@test.local',
        };
        const agentName = 'Agent Login Stable';

        await bootstrapGuestSession(page, true);
        await installAuthWorkspaceMocks(page, state, agentName);

        await page.goto('/');
        await expect(page.getByRole('button', { name: /Connexion|Sign In|Anmelden|Iniciar Sesión/i })).toBeVisible();
        await page.getByRole('button', { name: /Connexion|Sign In|Anmelden|Iniciar Sesión/i }).click();

        await page.locator('#login-email').fill('a24-login@test.local');
        await page.locator('#login-password').fill('password123');
        await page.getByRole('button', { name: /Se connecter|Sign In|Entrar|Anmelden/i }).click();

        await expect(page.getByText(agentName, { exact: true }).first()).toBeVisible();
        await expect(page.getByText('a24-login@test.local')).toBeVisible();

        const guestWorkflowAfterLogin = await page.evaluate((storageKey) => localStorage.getItem(storageKey), guestWorkflowStorageKey);
        expect(guestWorkflowAfterLogin).toBeNull();
        expect(state.workspaceRequests).toBe(1);
    });

    test('reload navigateur restaure immediatement le workspace hydrate', async ({ page }) => {
        const state: MockScenarioState = {
            workspaceRequests: 0,
            workflowRequests: 0,
            refreshRequests: 0,
            latestAccessToken: null,
            loginAccessToken: 'reload-access-token',
            refreshToken: 'reload-refresh-token',
            userId: 'user-a24-reload',
            userEmail: 'a24-reload@test.local',
        };
        const agentName = 'Agent Reload Stable';

        await bootstrapAuthenticatedSession(page, state);
        await installAuthWorkspaceMocks(page, state, agentName);

        await openAppAndWaitForAgent(page, agentName);
        await page.reload();
        await expect(page.getByText(agentName, { exact: true }).first()).toBeVisible();
        expect(state.workspaceRequests).toBe(2);
    });

    test('refresh token sur requete protegee ne fait jamais disparaitre le noeud du workflow', async ({ page }) => {
        const state: MockScenarioState = {
            workspaceRequests: 0,
            workflowRequests: 0,
            refreshRequests: 0,
            latestAccessToken: null,
            loginAccessToken: 'stale-workflow-token',
            refreshToken: 'refresh-token-a24',
            userId: 'user-a24-refresh',
            userEmail: 'a24-refresh@test.local',
            failWorkflowOnceForToken: 'stale-workflow-token',
            workspaceRefreshToken: 'refreshed-workflow-token',
            refreshDelayMs: 700,
        };
        const agentName = 'Agent Refresh Stable';

        await bootstrapAuthenticatedSession(page, state);
        await installAuthWorkspaceMocks(page, state, agentName);

        await openAppAndWaitForAgent(page, agentName);

        const tokenRefreshCompleted = page.waitForFunction(() => {
            const stored = localStorage.getItem('auth_data_v1');
            if (!stored) {
                return false;
            }

            return JSON.parse(stored).accessToken === 'refreshed-workflow-token';
        });

        await expectAgentNeverDisappears(page, agentName, 7, 180);
        await tokenRefreshCompleted;

        await expect(page.getByText(agentName, { exact: true }).first()).toBeVisible();
        expect(state.refreshRequests).toBe(1);
    });

    test('reprise apres veille via focus rehydrate le workspace sans perte visuelle ni confusion de source', async ({ page }) => {
        const state: MockScenarioState = {
            workspaceRequests: 0,
            workflowRequests: 0,
            refreshRequests: 0,
            latestAccessToken: null,
            loginAccessToken: 'sleep-old-token',
            refreshToken: 'sleep-refresh-token',
            userId: 'user-a24-sleep',
            userEmail: 'a24-sleep@test.local',
            workspaceRefreshToken: 'sleep-new-token',
            refreshDelayMs: 700,
        };
        const agentName = 'Agent Resume Stable';

        await bootstrapAuthenticatedSession(page, state);
        await installAuthWorkspaceMocks(page, state, agentName);

        await openAppAndWaitForAgent(page, agentName);
        await page.waitForFunction(() => sessionStorage.getItem('_arc_hydrating') !== 'true');

        state.requireFreshWorkspaceToken = true;

        const resumeRefreshCompleted = page.waitForFunction(() => {
            const stored = localStorage.getItem('auth_data_v1');
            if (!stored) {
                return false;
            }

            return JSON.parse(stored).accessToken === 'sleep-new-token';
        });

        await page.evaluate(() => {
            window.dispatchEvent(new Event('focus'));
        });

        await expectAgentNeverDisappears(page, agentName, 7, 180);
        await resumeRefreshCompleted;

        await expect(page.getByText(agentName, { exact: true }).first()).toBeVisible();
        expect(state.workspaceRequests).toBeGreaterThanOrEqual(2);
        expect(state.refreshRequests).toBe(1);
    });
});