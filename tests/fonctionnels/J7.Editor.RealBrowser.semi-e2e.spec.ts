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
        summary: 'Imports critiques manquants ou cassés pour: web_search_py',
        probes: [
            {
                toolName: 'web_search_py',
                status: 'degraded',
                summary: 'Imports critiques indisponibles pour web_search_py: duckduckgo_search',
                checkedAt: now,
                imports: [
                    {
                        dependency: 'duckduckgo-search',
                        module: 'duckduckgo_search',
                        available: false,
                        detail: 'ModuleNotFoundError: No module named duckduckgo_search'
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
            sourceInline: 'export function run(context, args) { return { result: `Bonjour ${args.user_name}. Ton nom est maintenant enregistré dans ma mémoire.`, admin: args.is_admin, depth: context.depth }; }',
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
                sourceInline: 'export function run(context, args) { return { result: `Bonjour ${args.user_name}. Ton nom est maintenant enregistré dans ma mémoire.`, admin: args.is_admin, depth: context.depth }; }',
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
        dependencies: { npm: [], python: ['duckduckgo-search==6.1.0'] },
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
            requirement: 'platform_provision',
            state: 'waiting_for_provisioning',
            prepared: false,
            runnable: false,
            dependencyReadiness: 'missing',
            runtimeReady: true,
            summary: 'Provisionnement plateforme requis avant execution de cette fonction native.',
            actionLabel: 'Provisionnement plateforme requis'
        }
    }),
];

const runResponses = new Map<string, any>([
    [tsLegacyFunctionId, {
        success: true,
        output: {
            result: 'Bonjour Ada. Ton nom est maintenant enregistré dans ma mémoire.',
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

        if (path.startsWith('/api/functions/') && method === 'PUT') {
            const functionId = path.split('/').pop();
            const matchingTool = tools.find((tool) => tool.legacyFunctionId === functionId);
            if (!matchingTool) {
                return fulfillJson(route, 404, { error: 'Fonction introuvable' });
            }

            const payload = request.postDataJSON() as Record<string, unknown>;
            return fulfillJson(route, 200, {
                _id: matchingTool.legacyFunctionId,
                toolId: matchingTool.id,
                name: matchingTool.name,
                description: matchingTool.description,
                language: matchingTool.runtime,
                origin: matchingTool.origin,
                userId: null,
                workflowId: matchingTool.workflowId,
                inputSchema: payload.inputSchema ?? matchingTool.inputSchema,
                outputSchema: payload.outputSchema ?? matchingTool.outputSchema,
                codePath: matchingTool.currentVersion.sourcePath,
                resolvedCodePath: matchingTool.currentVersion.sourcePath,
                codePathRoot: matchingTool.origin === 'native' ? 'native_repo' : 'workspace_source',
                codeInline: payload.codeInline ?? matchingTool.currentVersion.sourceInline,
                dependencies: matchingTool.runtime === 'python' ? matchingTool.dependencies.python : matchingTool.dependencies.npm,
                isEnabled: matchingTool.isEnabled,
                isReadonly: matchingTool.isReadonly,
                version: 1,
                versionTag: matchingTool.currentVersion.versionTag,
                tags: matchingTool.tags,
                readinessStatus: matchingTool.readinessStatus,
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
        await expect(page.getByText('Exemple QA TypeScript: la fonction lit des donnees JSON strictes depuis args.user_name et args.is_admin.')).toBeVisible();

        await page.getByLabel('Arguments de test JSON').fill(`{
      "user_name": "Ada",
      "is_admin": false
    }`);
        await page.getByRole('button', { name: 'Exécuter' }).click();

                await expect(page.getByTestId('function-editor-sidebar').getByText('Résultat', { exact: true })).toBeVisible();
        await expect(page.getByText('Bonjour Ada. Ton nom est maintenant enregistré dans ma mémoire.')).toBeVisible();
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

    test('projette dans l editeur le blocage readiness d une native readonly non preparee', async ({ page }) => {
        await openPhilFunctionsPage(page);

                await page.getByText('web_search_py', { exact: true }).click();
        await page.getByRole('button', { name: 'Éditeur' }).click();

        await expect(page.getByText('Provisionnement plateforme en attente')).toBeVisible();
        await expect(page.getByText('Categorie Native readonly')).toBeVisible();
        await expect(page.getByText('Imports natifs critiques en echec: web_search_py')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Préparer build' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Exécuter' })).toBeDisabled();
    });
});