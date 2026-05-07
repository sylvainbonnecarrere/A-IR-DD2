import { expect, test, type Page, type Route } from '@playwright/test';

const workflowId = '64f000000000000000000001';
const tsLegacyFunctionId = '64f000000000000000000101';
const tsToolId = '64f000000000000000000201';
const pyLegacyFunctionId = '64f000000000000000000102';
const pyToolId = '64f000000000000000000202';
const nativeLegacyFunctionId = '64f000000000000000000103';
const nativeToolId = '64f000000000000000000203';
const now = '2026-03-29T12:00:00.000Z';

const runtimeCompatibility = {
    checkedAt: now,
    mode: 'docker-desktop',
    securityLevel: 'dev-only',
    executionReady: true,
    preferredRunner: 'docker_sandbox',
    warning: 'Docker Desktop est reserve au dev/test.',
    summary: 'Runtime ready in dev mode.'
};

const workspaceSummary = {
    id: 'ws-j7-editor',
    logicalRoot: 'wf-j7-editor',
    runtimeRoots: {
        sourceRoot: 'source',
        manifestsRoot: 'manifests',
        buildRoot: 'build',
        outputRoot: 'output'
    },
    manifests: {
        packageJson: true,
        packageLockJson: true,
        requirementsTxt: true,
        pyprojectToml: false
    },
    status: 'active',
    lastScanAt: now,
    workflowId
};

const runtimeHealth = {
    status: 'degraded',
    checkedAt: now,
    summary: 'Runtime MVP incomplet: imports natifs critiques',
    components: [],
    nativePython: {
        available: false,
        status: 'degraded',
        summary: 'Imports critiques manquants ou cassés pour: web_fetch_py',
        probes: [
            {
                toolName: 'web_fetch_py',
                status: 'degraded',
                summary: 'Imports critiques indisponibles pour web_fetch_py: requests',
                checkedAt: now,
                imports: [
                    {
                        dependency: 'requests',
                        module: 'requests',
                        available: false,
                        detail: 'ModuleNotFoundError: No module named requests'
                    }
                ]
            }
        ]
    },
    runtime: {
        node: { available: true, status: 'healthy', executable: 'node', version: '24.8.0' },
        python: { available: true, status: 'healthy', executable: 'python3', version: '3.11.0' },
        docker: {
            available: true,
            status: 'healthy',
            executable: 'docker',
            version: '27.0.0',
            rootless: false,
            mode: 'docker-desktop',
            securityLevel: 'dev-only',
            executionReady: true,
            warning: 'Docker Desktop est reserve au dev/test.'
        },
        images: {
            node: { available: true, status: 'healthy', image: 'airdd2/node' },
            python: { available: true, status: 'healthy', image: 'airdd2/python' }
        },
        runners: {
            preferred: 'docker_sandbox',
            dockerSandbox: { runner: 'docker_sandbox', available: true, status: 'healthy' },
            firecracker: { runner: 'firecracker', available: false, status: 'degraded', detail: 'Not configured' }
        },
        typescript: { available: true, status: 'healthy', engine: 'node-subprocess' }
    },
    capabilities: {
        build: { typescript: true, python: true },
        run: { typescript: true, python: true, dockerRootless: false }
    },
    python: { available: true, executable: 'python3', version: '3.11.0' },
    typescript: { available: true, engine: 'node-subprocess' }
};

const workspacePayload = {
    runtimeCompatibility,
    workflow: {
        id: workflowId,
        _id: workflowId,
        name: 'Workflow J7 Editor',
        description: 'Semi-E2E editor validation',
        isActive: true,
        isDefault: true,
        isDirty: false,
        canvasState: { zoom: 1, panX: 0, panY: 0 },
        createdAt: now,
        updatedAt: now,
    },
    nodes: [],
    edges: [],
    agentInstances: [],
    agentPrototypes: [],
    llmConfigs: [],
    toolRuns: [],
    metadata: {
        userId: 'user-j7-editor',
        source: 'api',
        loadedAt: now,
        hasWorkflow: true,
    }
};

function createToolRecord(overrides: Record<string, unknown>) {
    return {
        scopeType: 'user',
        workflowId,
        workspaceId: workspaceSummary.id,
        status: 'ready',
        trustLevel: 'user_private',
        currentVersion: {
            versionTag: 'v1',
            contentHash: 'content-hash',
            sourceMode: 'inline',
            sourcePath: null,
            sourceInline: null,
            entrypoint: null,
            createdAt: now,
            createdBy: 'user-j7-editor',
            buildStatus: 'not_built',
            validationStatus: 'valid'
        },
        versions: [
            {
                versionTag: 'v1',
                contentHash: 'content-hash',
                sourceMode: 'inline',
                sourcePath: null,
                sourceInline: null,
                entrypoint: null,
                createdAt: now,
                createdBy: 'user-j7-editor',
                buildStatus: 'not_built',
                validationStatus: 'valid'
            }
        ],
        policy: {
            networkMode: 'restricted',
            writablePaths: [],
            secretAliases: [],
            timeoutSeconds: 30,
            maxMemoryMb: 256
        },
        compatibilityAliases: {
            functionId: tsLegacyFunctionId
        },
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

const tools = [
    createToolRecord({
        id: tsToolId,
        legacyFunctionId: tsLegacyFunctionId,
        name: 'hello_test',
        displayName: 'Hello Test TS',
        description: 'Fonction TypeScript de reference QA',
        runtime: 'typescript',
        origin: 'custom',
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
        tags: ['qa', 'typescript'],
        dependencies: { npm: [], python: [] },
        isReadonly: false,
        isEnabled: true,
        currentVersion: {
            versionTag: 'v1',
            contentHash: 'ts-content-hash',
            sourceMode: 'inline',
            sourcePath: 'tools/hello_test.ts',
            sourceInline: 'export function run(context, args) { const userName = typeof args.user_name === "string" && args.user_name.trim().length > 0 ? args.user_name.trim() : "inconnu"; return { result: `Ton nom, ${userName}, est maintenant enregistré dans ma mémoire` }; }',
            entrypoint: null,
            createdAt: now,
            createdBy: 'user-j7-editor',
            buildStatus: 'not_built',
            validationStatus: 'valid'
        },
        versions: [
            {
                versionTag: 'v1',
                contentHash: 'ts-content-hash',
                sourceMode: 'inline',
                sourcePath: 'tools/hello_test.ts',
                sourceInline: 'export function run(context, args) { const userName = typeof args.user_name === "string" && args.user_name.trim().length > 0 ? args.user_name.trim() : "inconnu"; return { result: `Ton nom, ${userName}, est maintenant enregistré dans ma mémoire` }; }',
                entrypoint: null,
                createdAt: now,
                createdBy: 'user-j7-editor',
                buildStatus: 'not_built',
                validationStatus: 'valid'
            }
        ],
        readinessStatus: {
            requirement: 'author_build',
            state: 'waiting_for_build',
            prepared: false,
            runnable: true,
            dependencyReadiness: 'satisfied',
            runtimeReady: true,
            summary: 'La fonction peut etre testee dans le sandbox. Le build auteur reste disponible pour la preparation workflow.',
            actionLabel: 'Build auteur disponible'
        }
    }),
    createToolRecord({
        id: pyToolId,
        legacyFunctionId: pyLegacyFunctionId,
        name: 'hello_test_py',
        displayName: 'Hello Test Python',
        description: 'Fonction Python de reference QA',
        runtime: 'python',
        origin: 'custom',
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
        tags: ['qa', 'python'],
        dependencies: { npm: [], python: [] },
        isReadonly: false,
        isEnabled: true,
        currentVersion: {
            versionTag: 'v1',
            contentHash: 'py-content-hash',
            sourceMode: 'inline',
            sourcePath: 'tools/hello_test_py.py',
            sourceInline: 'def run(args):\n    return {"result": f"Bonjour {args.get(\"user_name\")}", "score": args.get("score")}',
            entrypoint: null,
            createdAt: now,
            createdBy: 'user-j7-editor',
            buildStatus: 'not_built',
            validationStatus: 'valid'
        },
        versions: [
            {
                versionTag: 'v1',
                contentHash: 'py-content-hash',
                sourceMode: 'inline',
                sourcePath: 'tools/hello_test_py.py',
                sourceInline: 'def run(args):\n    return {"result": f"Bonjour {args.get(\"user_name\")}", "score": args.get("score")}',
                entrypoint: null,
                createdAt: now,
                createdBy: 'user-j7-editor',
                buildStatus: 'not_built',
                validationStatus: 'valid'
            }
        ],
        readinessStatus: {
            requirement: 'author_build',
            state: 'waiting_for_build',
            prepared: false,
            runnable: true,
            dependencyReadiness: 'satisfied',
            runtimeReady: true,
            summary: 'La fonction Python peut etre testee avant build dans le sandbox auteur.',
            actionLabel: 'Build auteur disponible'
        }
    }),
    createToolRecord({
        id: nativeToolId,
        legacyFunctionId: nativeLegacyFunctionId,
        name: 'web_search_py',
        displayName: 'Web Search',
        description: 'Recherche web native',
        runtime: 'python',
        origin: 'native',
        scopeType: 'native',
        workflowId: null,
        workspaceId: null,
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
        tags: ['search', 'native'],
        dependencies: { npm: [], python: [] },
        isReadonly: true,
        isEnabled: true,
        currentVersion: {
            versionTag: 'v1',
            contentHash: 'native-content-hash',
            sourceMode: 'path',
            sourcePath: 'backend/python/native/web_search_py.py',
            sourceInline: null,
            entrypoint: null,
            createdAt: now,
            createdBy: null,
            buildStatus: 'not_built',
            validationStatus: 'valid'
        },
        versions: [
            {
                versionTag: 'v1',
                contentHash: 'native-content-hash',
                sourceMode: 'path',
                sourcePath: 'backend/python/native/web_search_py.py',
                sourceInline: null,
                entrypoint: null,
                createdAt: now,
                createdBy: null,
                buildStatus: 'not_built',
                validationStatus: 'valid'
            }
        ],
        readinessStatus: {
            requirement: 'none',
            state: 'ready',
            prepared: true,
            runnable: true,
            dependencyReadiness: 'not_required',
            runtimeReady: true,
            summary: 'Aucune preparation supplementaire requise avant execution.',
            actionLabel: 'Executable immediatement'
        }
    }),
];

const runResponses = new Map<string, any>([
    [tsLegacyFunctionId, {
        success: true,
        output: {
            result: 'Ton nom, Ada, est maintenant enregistré dans ma mémoire',
            admin: false,
            depth: 0
        },
        stdout: 'hello_test executed',
        stderr: '',
        durationMs: 18,
        executionId: 'run-ts-1',
        runner: 'docker_sandbox',
        exitCode: 0,
        resourceUsage: {
            wallTimeMs: 18,
            memoryLimitMb: 256
        },
        metadata: {
            artifacts: []
        }
    }],
    [pyLegacyFunctionId, {
        success: true,
        output: {
            result: 'Bonjour Ada',
            score: 42
        },
        stdout: 'hello_test_py executed',
        stderr: '',
        durationMs: 16,
        executionId: 'run-py-1',
        runner: 'docker_sandbox',
        exitCode: 0,
        resourceUsage: {
            wallTimeMs: 16,
            memoryLimitMb: 256
        },
        metadata: {
            artifacts: []
        }
    }],
]);

async function fulfillJson(route: Route, status: number, body: unknown) {
    await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
        headers: {
            'access-control-allow-origin': '*'
        }
    });
}

async function installApiMocks(page: Page) {
    await page.route('**/api/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const path = url.pathname;
        const method = request.method();

        if (path === '/api/llm/get-all-api-keys' && method === 'POST') {
            return fulfillJson(route, 200, []);
        }

        if (path === '/api/local-llm-profiles' && method === 'GET') {
            return fulfillJson(route, 200, []);
        }

        if (path === '/api/user/workspace' && method === 'GET') {
            return fulfillJson(route, 200, workspacePayload);
        }

        if (path === '/api/workflows' && method === 'GET') {
            return fulfillJson(route, 200, {
                workflows: [
                    {
                        _id: workflowId,
                        userId: 'user-j7-editor',
                        name: 'Workflow J7 Editor',
                        description: 'Semi-E2E editor validation',
                        isActive: true,
                        isDefault: true,
                        createdAt: now,
                        updatedAt: now,
                        agentCount: 0
                    }
                ]
            });
        }

        if (path === '/api/tools' && method === 'GET') {
            return fulfillJson(route, 200, {
                items: tools,
                runtimeCompatibility
            });
        }

        if (path === `/api/workspaces/${workflowId}` && method === 'GET') {
            return fulfillJson(route, 200, {
                workspace: workspaceSummary,
                metrics: {
                    toolCount: tools.length,
                    runCount: 0
                },
                runtimeCompatibility
            });
        }

        if (path === '/api/sandbox/health' && method === 'GET') {
            return fulfillJson(route, 200, runtimeHealth);
        }

        if (path === '/api/runs' && method === 'GET') {
            return fulfillJson(route, 200, {
                items: [],
                pagination: {
                    page: 1,
                    limit: 20,
                    total: 0,
                    totalPages: 1,
                    sortBy: 'createdAt',
                    sortOrder: 'desc'
                },
                runtimeCompatibility
            });
        }

        if (path.startsWith('/api/tools/') && path.endsWith('/build-status') && method === 'GET') {
            return fulfillJson(route, 404, { error: 'Aucun build disponible pour ce tool/version' });
        }

        if (path.startsWith('/api/tools/') && method === 'PUT') {
            const functionId = path.split('/').pop();
            const matchingTool = tools.find((tool) => tool.legacyFunctionId === functionId);
            if (!matchingTool) {
                return fulfillJson(route, 404, { error: 'Fonction introuvable' });
            }

            const payload = request.postDataJSON() as Record<string, unknown>;
            const updatedTool = {
                ...matchingTool,
                description: typeof payload.description === 'string' ? payload.description : matchingTool.description,
                inputSchema: (payload.inputSchema as Record<string, unknown> | undefined) ?? matchingTool.inputSchema,
                outputSchema: (payload.outputSchema as Record<string, unknown> | undefined) ?? matchingTool.outputSchema,
                currentVersion: {
                    ...matchingTool.currentVersion,
                    sourceInline: typeof payload.codeInline === 'string' ? payload.codeInline : matchingTool.currentVersion.sourceInline
                },
                updatedAt: now,
            };
            const toolIndex = tools.findIndex((tool) => tool.legacyFunctionId === functionId);
            if (toolIndex >= 0) {
                tools[toolIndex] = updatedTool;
            }

            if (path.startsWith('/api/tools/')) {
                return fulfillJson(route, 200, {
                    tool: updatedTool,
                    runtimeCompatibility
                });
            }

            return fulfillJson(route, 200, {
                _id: matchingTool.legacyFunctionId,
                toolId: updatedTool.id,
                name: updatedTool.name,
                description: updatedTool.description,
                language: updatedTool.runtime,
                origin: updatedTool.origin,
                userId: null,
                workflowId: updatedTool.workflowId,
                inputSchema: updatedTool.inputSchema,
                outputSchema: updatedTool.outputSchema,
                codePath: updatedTool.currentVersion.sourcePath,
                resolvedCodePath: updatedTool.currentVersion.sourcePath,
                codePathRoot: updatedTool.origin === 'native' ? 'native_repo' : 'workspace_source',
                codeInline: updatedTool.currentVersion.sourceInline,
                dependencies: updatedTool.runtime === 'python' ? updatedTool.dependencies.python : updatedTool.dependencies.npm,
                isEnabled: updatedTool.isEnabled,
                isReadonly: updatedTool.isReadonly,
                version: 1,
                versionTag: updatedTool.currentVersion.versionTag,
                tags: updatedTool.tags,
                readinessStatus: updatedTool.readinessStatus,
                createdAt: now,
                updatedAt: now,
                runtimeCompatibility
            });
        }

        if (path === '/api/sandbox/run' && method === 'POST') {
            const payload = request.postDataJSON() as { functionId: string; testArgs: Record<string, unknown> };
            const response = runResponses.get(payload.functionId);
            if (!response) {
                return fulfillJson(route, 409, {
                    error: 'This native tool version declares dependencies and requires platform provisioning before sandbox execution.',
                    errorDetails: {
                        code: 'PLATFORM_PROVISION_REQUIRED',
                        subsystem: 'build_preparation',
                        retryable: false,
                    }
                });
            }

            return fulfillJson(route, 200, response);
        }

        return fulfillJson(route, 404, { error: `Unhandled API route in semi-E2E: ${method} ${path}` });
    });
}

async function bootstrapAuthenticatedSession(page: Page) {
    await page.addInitScript(() => {
        localStorage.setItem('auth_data_v1', JSON.stringify({
            user: {
                id: 'user-j7-editor',
                email: 'j7-editor@test.local',
                role: 'user'
            },
            accessToken: 'semi-e2e-access-token',
            refreshToken: 'semi-e2e-refresh-token'
        }));
    });
}

async function openPhilFunctionsPage(page: Page) {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Phil' })).toBeVisible();
    await page.getByRole('button', { name: 'Phil' }).click();
    await page.getByRole('button', { name: 'Fonctions Personnalisées' }).click();
    await expect(page.getByRole('heading', { name: 'Fonctions Personnalisées' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
    await bootstrapAuthenticatedSession(page);
    await installApiMocks(page);
});

test.describe('J7 semi-E2E navigateur réel — parcours éditeur', () => {
    test('execute une fonction TypeScript simple depuis l editeur avec Monaco et JSON strict', async ({ page }) => {
        await openPhilFunctionsPage(page);

        await page.getByText('hello_test', { exact: true }).click();
        await page.getByRole('button', { name: 'Ouvrir dans l\'éditeur' }).click();

        await expect(page.locator('.monaco-editor')).toBeVisible();
                await expect(page.getByText('Exemple QA TypeScript: la fonction lit des donnees JSON strictes depuis args.user_name.')).toBeVisible();

        await page.getByLabel('Arguments de test JSON').fill(`{
            "user_name": "Ada"
    }`);
        await page.getByRole('button', { name: 'Exécuter' }).click();

                await expect(page.getByTestId('function-editor-sidebar').getByText('Résultat', { exact: true })).toBeVisible();
                await expect(page.getByText('Ton nom, Ada, est maintenant enregistré dans ma mémoire')).toBeVisible();
        await expect(page.getByText('hello_test executed')).toBeVisible();
    });

    test('execute une fonction Python simple depuis l editeur avec aide QA et sortie visible', async ({ page }) => {
        await openPhilFunctionsPage(page);

                await page.getByText('hello_test_py', { exact: true }).click();
        await page.getByRole('button', { name: 'Ouvrir dans l\'éditeur' }).click();

        await expect(page.locator('.monaco-editor')).toBeVisible();
        await expect(page.getByText('Exemple QA Python: la fonction lit des donnees JSON strictes depuis args, par exemple args["user_name"] et args["score"].')).toBeVisible();

        await page.getByLabel('Arguments de test JSON').fill(`{
      "user_name": "Ada",
      "score": 42
    }`);
        await page.getByRole('button', { name: 'Exécuter' }).click();

                await expect(page.getByTestId('function-editor-sidebar').getByText('Résultat', { exact: true })).toBeVisible();
        await expect(page.getByText('Bonjour Ada')).toBeVisible();
        await expect(page.getByText('hello_test_py executed')).toBeVisible();
    });

    test('projette dans l editeur l execution immediate d une native readonly sans dependances', async ({ page }) => {
        await openPhilFunctionsPage(page);

                await page.getByText('web_search_py', { exact: true }).click();
        await page.getByRole('button', { name: 'Éditeur' }).click();

        await expect(page.getByText('Aucune preparation supplementaire requise')).toBeVisible();
        await expect(page.getByText('Categorie Native readonly')).toBeVisible();
        await expect(page.getByText('Imports natifs critiques en echec: web_fetch_py')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Préparer build' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Exécuter' })).toBeEnabled();
    });
});