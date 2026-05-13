import { expect, test, type Page, type Route } from '@playwright/test';

const workflowId = '64f000000000000000000001';
const tsLegacyFunctionId = '64f000000000000000000101';
const tsToolId = '64f000000000000000000201';
const pyLegacyFunctionId = '64f000000000000000000102';
const pyToolId = '64f000000000000000000202';
const nativeLegacyFunctionId = '64f000000000000000000103';
const nativeToolId = '64f000000000000000000203';
const provisionNativeLegacyFunctionId = '64f000000000000000000104';
const provisionNativeToolId = '64f000000000000000000204';
const createdTsLegacyFunctionId = '64f000000000000000000105';
const createdTsToolId = '64f000000000000000000205';
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
    const legacyFunctionId = typeof overrides.legacyFunctionId === 'string'
        ? overrides.legacyFunctionId
        : tsLegacyFunctionId;

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
            functionId: legacyFunctionId
        },
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

function createInitialTools() {
    return [
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
            id: provisionNativeToolId,
            legacyFunctionId: provisionNativeLegacyFunctionId,
            name: 'web_fetch_py',
            displayName: 'Web Fetch',
            description: 'Fetch web natif avec dependances Python critiques',
            runtime: 'python',
            origin: 'native',
            scopeType: 'native',
            workflowId: null,
            workspaceId: null,
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
            tags: ['fetch', 'native'],
            dependencies: { npm: [], python: ['requests'] },
            isReadonly: true,
            isEnabled: true,
            currentVersion: {
                versionTag: 'v1',
                contentHash: 'native-fetch-content-hash',
                sourceMode: 'path',
                sourcePath: 'backend/python/native/web_fetch_py.py',
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
                    contentHash: 'native-fetch-content-hash',
                    sourceMode: 'path',
                    sourcePath: 'backend/python/native/web_fetch_py.py',
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
                state: 'waiting_for_provision',
                prepared: false,
                runnable: false,
                dependencyReadiness: 'missing',
                runtimeReady: true,
                summary: 'Cette fonction native doit etre preparee et provisionnee par la plateforme avant execution fiable.',
                actionLabel: 'Provisionnement plateforme requis'
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
}

function cloneCurrentVersion(tool: any) {
    return {
        ...tool.currentVersion,
    };
}

function createBuildReport(tool: any) {
    const extension = tool.runtime === 'python' ? 'py' : 'js';
    const artifactPath = tool.runtime === 'python'
        ? `build/tools/${tool.name}/${tool.name}.py`
        : `build/tools/${tool.name}/index.js`;
    const manifestPaths = tool.runtime === 'python'
        ? [`manifests/tools/${tool.name}/requirements.txt`]
        : [`manifests/tools/${tool.name}/package.json`, `manifests/tools/${tool.name}/tsconfig.json`];

    return {
        toolId: tool.id,
        toolVersionTag: tool.currentVersion.versionTag,
        functionId: tool.id,
        functionName: tool.name,
        language: tool.runtime,
        workspaceId: tool.workspaceId ?? workspaceSummary.id,
        workflowId: tool.workflowId ?? workflowId,
        buildRoot: `build/tools/${tool.name}`,
        sourcePath: tool.currentVersion.sourcePath ?? `tools/${tool.name}.${extension}`,
        status: 'ready',
        builtAt: now,
        manifestPaths,
        artifactPaths: [artifactPath],
        warnings: []
    };
}

function markToolBuilt(tool: any) {
    tool.currentVersion = {
        ...cloneCurrentVersion(tool),
        buildStatus: 'built'
    };
    tool.versions = [cloneCurrentVersion(tool)];

    if (tool.readinessStatus?.requirement === 'author_build') {
        tool.readinessStatus = {
            ...tool.readinessStatus,
            state: 'ready',
            prepared: true,
            runnable: true,
            dependencyReadiness: 'satisfied',
            summary: 'Le build auteur a prepare les artefacts de cette version.',
            actionLabel: 'Build confirme'
        };
    }
}

function markToolProvisioned(tool: any) {
    tool.currentVersion = {
        ...cloneCurrentVersion(tool),
        buildStatus: 'built'
    };
    tool.versions = [cloneCurrentVersion(tool)];
    tool.readinessStatus = {
        ...tool.readinessStatus,
        requirement: 'platform_provision',
        state: 'ready',
        prepared: true,
        runnable: true,
        dependencyReadiness: 'satisfied',
        runtimeReady: true,
        summary: 'Le provisionnement plateforme a prepare les dependances requises pour cette execution.',
        actionLabel: 'Provisionnement plateforme confirme'
    };
}

function createSandboxResponse(toolId: string, testArgs: Record<string, unknown>) {
    const userName = typeof testArgs.user_name === 'string' && testArgs.user_name.trim().length > 0
        ? testArgs.user_name.trim()
        : 'inconnu';

    if (toolId === tsToolId || toolId === createdTsToolId) {
        return {
            success: true,
            output: {
                result: `Ton nom, ${userName}, est maintenant enregistré dans ma mémoire`,
                admin: false,
                depth: 0
            },
            stdout: toolId === createdTsToolId ? 'workflow_tool_ts executed' : 'hello_test executed',
            stderr: '',
            durationMs: 18,
            executionId: toolId === createdTsToolId ? 'run-ts-created-1' : 'run-ts-1',
            runner: 'docker_sandbox',
            exitCode: 0,
            resourceUsage: {
                wallTimeMs: 18,
                memoryLimitMb: 256
            },
            metadata: {
                artifacts: []
            }
        };
    }

    if (toolId === pyToolId) {
        return {
            success: true,
            output: {
                result: `Bonjour ${userName}`,
                score: testArgs.score ?? 42
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
        };
    }

    if (toolId === provisionNativeToolId) {
        return {
            success: true,
            output: {
                items: [
                    { title: 'Ada Lovelace', url: 'https://example.test/ada' },
                    { title: 'Charles Babbage', url: 'https://example.test/babbage' }
                ],
                total: 2
            },
            stdout: 'web_fetch_py provisioned and executed',
            stderr: '',
            durationMs: 24,
            executionId: 'run-native-provision-1',
            runner: 'docker_sandbox',
            exitCode: 0,
            resourceUsage: {
                wallTimeMs: 24,
                memoryLimitMb: 256
            },
            metadata: {
                artifacts: []
            }
        };
    }

    if (toolId === nativeToolId) {
        return {
            success: true,
            output: {
                items: [
                    { title: 'Recherche Web 1', url: 'https://example.test/search-1' }
                ],
                total: 1
            },
            stdout: 'web_search_py executed',
            stderr: '',
            durationMs: 15,
            executionId: 'run-native-1',
            runner: 'docker_sandbox',
            exitCode: 0,
            resourceUsage: {
                wallTimeMs: 15,
                memoryLimitMb: 256
            },
            metadata: {
                artifacts: []
            }
        };
    }

    return null;
}

interface MockApiState {
    tools: ReturnType<typeof createInitialTools>;
    buildRequests: string[];
    provisionRequests: string[];
    runRequests: Array<Record<string, unknown>>;
    implicitProvisionedRuns: string[];
    buildReports: Map<string, ReturnType<typeof createBuildReport>>;
}

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

async function installApiMocks(page: Page): Promise<MockApiState> {
    const tools = createInitialTools();
    const buildRequests: string[] = [];
    const provisionRequests: string[] = [];
    const runRequests: Array<Record<string, unknown>> = [];
    const implicitProvisionedRuns: string[] = [];
    const buildReports = new Map<string, ReturnType<typeof createBuildReport>>();

    const findCanonicalTool = (toolId: string) => tools.find((tool) => tool.id === toolId);
    const isLegacyFunctionId = (toolId: string) => tools.some((tool) => tool.legacyFunctionId === toolId);

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

        if (path === '/api/tools' && method === 'POST') {
            const payload = request.postDataJSON() as Record<string, unknown>;
            const runtime = payload.runtime === 'python' || payload.language === 'python' ? 'python' : 'typescript';
            const createdTool = createToolRecord({
                id: createdTsToolId,
                legacyFunctionId: createdTsLegacyFunctionId,
                name: payload.name,
                displayName: payload.name,
                description: payload.description,
                runtime,
                origin: 'custom',
                workflowId: payload.workflowId ?? workflowId,
                workspaceId: workspaceSummary.id,
                inputSchema: (payload.inputSchema as Record<string, unknown> | undefined) ?? { type: 'object' },
                outputSchema: (payload.outputSchema as Record<string, unknown> | undefined) ?? { type: 'object' },
                tags: Array.isArray(payload.tags) ? payload.tags : ['qa', 'created'],
                dependencies: runtime === 'python'
                    ? { npm: [], python: Array.isArray(payload.dependencies) ? payload.dependencies as string[] : [] }
                    : { npm: Array.isArray(payload.dependencies) ? payload.dependencies as string[] : [], python: [] },
                isReadonly: false,
                isEnabled: true,
                currentVersion: {
                    versionTag: 'v1',
                    contentHash: 'created-ts-content-hash',
                    sourceMode: 'inline',
                    sourcePath: `tools/${String(payload.name)}.${runtime === 'python' ? 'py' : 'ts'}`,
                    sourceInline: typeof payload.codeInline === 'string' ? payload.codeInline : null,
                    entrypoint: null,
                    createdAt: now,
                    createdBy: 'user-j7-editor',
                    buildStatus: 'not_built',
                    validationStatus: 'valid'
                },
                versions: [
                    {
                        versionTag: 'v1',
                        contentHash: 'created-ts-content-hash',
                        sourceMode: 'inline',
                        sourcePath: `tools/${String(payload.name)}.${runtime === 'python' ? 'py' : 'ts'}`,
                        sourceInline: typeof payload.codeInline === 'string' ? payload.codeInline : null,
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
                    summary: 'La nouvelle fonction workflow-scoped attend son build auteur pour la preparation QA.',
                    actionLabel: 'Build auteur disponible'
                }
            });

            tools.push(createdTool);
            return fulfillJson(route, 201, {
                tool: createdTool,
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
            const toolId = path.split('/')[3];
            if (isLegacyFunctionId(toolId)) {
                return fulfillJson(route, 409, { error: 'Legacy functionId build status path must not be used in semi-E2E.' });
            }

            const buildReport = buildReports.get(toolId);
            if (!buildReport) {
                return fulfillJson(route, 404, { error: 'Aucun build disponible pour ce tool/version' });
            }

            return fulfillJson(route, 200, buildReport);
        }

        if (path.startsWith('/api/tools/') && path.endsWith('/build') && method === 'POST') {
            const toolId = path.split('/')[3];
            if (isLegacyFunctionId(toolId)) {
                return fulfillJson(route, 409, { error: 'Legacy functionId build path must not be used in semi-E2E.' });
            }

            const matchingTool = findCanonicalTool(toolId);
            if (!matchingTool) {
                return fulfillJson(route, 404, { error: 'Fonction introuvable' });
            }

            buildRequests.push(toolId);
            markToolBuilt(matchingTool);
            const buildReport = createBuildReport(matchingTool);
            buildReports.set(toolId, buildReport);

            return fulfillJson(route, 200, buildReport);
        }

        if (path.startsWith('/api/tools/') && path.endsWith('/provision') && method === 'POST') {
            const toolId = path.split('/')[3];
            if (isLegacyFunctionId(toolId)) {
                return fulfillJson(route, 409, { error: 'Legacy functionId provision path must not be used in semi-E2E.' });
            }

            const matchingTool = findCanonicalTool(toolId);
            if (!matchingTool) {
                return fulfillJson(route, 404, { error: 'Fonction introuvable' });
            }

            provisionRequests.push(toolId);
            markToolProvisioned(matchingTool);
            const buildReport = createBuildReport(matchingTool);
            buildReports.set(toolId, buildReport);
            return fulfillJson(route, 200, buildReport);
        }

        if (/^\/api\/tools\/[^/]+$/.test(path) && method === 'PUT') {
            const toolId = path.split('/')[3];
            if (isLegacyFunctionId(toolId)) {
                return fulfillJson(route, 409, { error: 'Legacy functionId write path must not be used in semi-E2E.' });
            }

            const matchingTool = findCanonicalTool(toolId);
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
                    sourceInline: typeof payload.codeInline === 'string' ? payload.codeInline : matchingTool.currentVersion.sourceInline,
                    buildStatus: typeof payload.codeInline === 'string' ? 'not_built' : matchingTool.currentVersion.buildStatus
                },
                versions: [
                    {
                        ...matchingTool.currentVersion,
                        sourceInline: typeof payload.codeInline === 'string' ? payload.codeInline : matchingTool.currentVersion.sourceInline,
                        buildStatus: typeof payload.codeInline === 'string' ? 'not_built' : matchingTool.currentVersion.buildStatus
                    }
                ],
                readinessStatus: typeof payload.codeInline === 'string' && matchingTool.readinessStatus?.requirement === 'author_build'
                    ? {
                        ...matchingTool.readinessStatus,
                        state: 'waiting_for_build',
                        prepared: false,
                        runnable: true,
                        summary: 'Le code a change et attend un nouveau build auteur avant validation QA approfondie.',
                        actionLabel: 'Build auteur disponible'
                    }
                    : matchingTool.readinessStatus,
                updatedAt: now,
            };
            const toolIndex = tools.findIndex((tool) => tool.id === toolId);
            if (toolIndex >= 0) {
                tools[toolIndex] = updatedTool;
            }

            buildReports.delete(toolId);

            return fulfillJson(route, 200, {
                tool: updatedTool,
                runtimeCompatibility
            });
        }

        if (path === '/api/sandbox/run' && method === 'POST') {
            const payload = request.postDataJSON() as {
                functionId?: string;
                toolSelection?: { toolId?: string; versionRef?: Record<string, unknown> };
                testArgs?: Record<string, unknown>;
            };
            runRequests.push(payload as Record<string, unknown>);

            if (!payload.toolSelection?.toolId) {
                return fulfillJson(route, 409, {
                    error: 'Canonical toolSelection is required in the semi-E2E editor flow.',
                    errorDetails: {
                        code: 'BUILD_PREPARATION_ERROR',
                        subsystem: 'validation',
                        retryable: false,
                    }
                });
            }

            if (payload.functionId) {
                return fulfillJson(route, 409, {
                    error: 'Legacy functionId fallback must not be used when toolSelection is available.',
                    errorDetails: {
                        code: 'BUILD_PREPARATION_ERROR',
                        subsystem: 'validation',
                        retryable: false,
                    }
                });
            }

            const toolId = payload.toolSelection.toolId;
            const matchingTool = findCanonicalTool(toolId);
            if (!matchingTool) {
                return fulfillJson(route, 404, { error: 'Fonction introuvable' });
            }

            if (toolId === provisionNativeToolId && matchingTool.readinessStatus?.state !== 'ready') {
                implicitProvisionedRuns.push(toolId);
                markToolProvisioned(matchingTool);
                buildReports.set(toolId, createBuildReport(matchingTool));
            }

            const response = createSandboxResponse(toolId, payload.testArgs ?? {});
            if (!response) {
                return fulfillJson(route, 404, { error: `Aucune réponse mockée pour ${toolId}` });
            }

            return fulfillJson(route, 200, response);
        }

        return fulfillJson(route, 404, { error: `Unhandled API route in semi-E2E: ${method} ${path}` });
    });

    return {
        tools,
        buildRequests,
        provisionRequests,
        runRequests,
        implicitProvisionedRuns,
        buildReports
    };
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

let apiState: MockApiState;

test.beforeEach(async ({ page }) => {
    await bootstrapAuthenticatedSession(page);
    apiState = await installApiMocks(page);
});

test.describe('J7 semi-E2E navigateur réel — parcours éditeur', () => {
    test('cree une fonction TypeScript workflow-scoped puis enchaine build et run via les contrats canoniques tools/toolSelection', async ({ page }) => {
        await openPhilFunctionsPage(page);

        await page.getByRole('button', { name: 'Nouvelle fonction' }).click();
        await page.getByPlaceholder('ma_fonction_py').fill('workflow_tool_ts');
        await page.getByPlaceholder('Décrivez ce que fait cette fonction...').fill('Fonction TypeScript custom pour la non-regression create build run.');
        await page.getByRole('button', { name: /TypeScript/ }).click();
        await page.getByRole('button', { name: 'Créer' }).click();

        await expect(page.getByRole('heading', { name: 'workflow_tool_ts' })).toBeVisible();
        await expect.poll(() => apiState.tools.some((tool) => tool.id === createdTsToolId && tool.name === 'workflow_tool_ts')).toBe(true);

        await page.getByRole('button', { name: 'Ouvrir dans l\'éditeur' }).click();
        await expect(page.locator('.monaco-editor')).toBeVisible();

        await page.getByRole('button', { name: 'Préparer build' }).click();
        await expect.poll(() => apiState.buildRequests.at(-1)).toBe(createdTsToolId);
        await expect.poll(() => apiState.buildReports.has(createdTsToolId)).toBe(true);

        await page.getByLabel('Arguments de test JSON').fill(`{
            "user_name": "Lin"
        }`);
        await page.getByRole('button', { name: 'Exécuter' }).click();

        await expect(page.getByTestId('function-editor-sidebar').getByText('Résultat', { exact: true })).toBeVisible();
        await expect(page.getByText('Ton nom, Lin, est maintenant enregistré dans ma mémoire')).toBeVisible();
        await expect(page.getByText('workflow_tool_ts executed')).toBeVisible();
        await expect.poll(() => apiState.runRequests.length).toBe(1);
        await expect.poll(() => apiState.runRequests[0]?.functionId ?? null).toBe(null);
        await expect.poll(() => (apiState.runRequests[0]?.toolSelection as { toolId?: string } | undefined)?.toolId ?? null).toBe(createdTsToolId);
    });

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
            await expect.poll(() => apiState.runRequests.at(-1)?.functionId ?? null).toBe(null);
            await expect.poll(() => (apiState.runRequests.at(-1)?.toolSelection as { toolId?: string } | undefined)?.toolId ?? null).toBe(tsToolId);
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
        await expect.poll(() => apiState.runRequests.at(-1)?.functionId ?? null).toBe(null);
        await expect.poll(() => (apiState.runRequests.at(-1)?.toolSelection as { toolId?: string } | undefined)?.toolId ?? null).toBe(pyToolId);
    });

    test('execute un tool natif Python apres provisionnement plateforme puis run canonique', async ({ page }) => {
        await openPhilFunctionsPage(page);

        const provisionResult = await page.evaluate(async (toolId) => {
            const response = await fetch(`/api/tools/${toolId}/provision`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({})
            });

            return {
                status: response.status,
                body: await response.json()
            };
        }, provisionNativeToolId);

        expect(provisionResult.status).toBe(200);
        await expect.poll(() => apiState.provisionRequests.at(-1)).toBe(provisionNativeToolId);

        await openPhilFunctionsPage(page);
        await page.getByText('web_fetch_py', { exact: true }).click();
        await page.getByRole('button', { name: 'Éditeur' }).click();

        await expect(page.getByText('Provisionnement plateforme confirme', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Exécuter' })).toBeEnabled();

        await page.getByLabel('Arguments de test JSON').fill(`{
            "user_name": "Ada",
            "query": "Ada Lovelace"
        }`);
        await page.getByRole('button', { name: 'Exécuter' }).click();

        await expect(page.getByTestId('function-editor-sidebar').getByText('Résultat', { exact: true })).toBeVisible();
        await expect(page.getByText('web_fetch_py provisioned and executed')).toBeVisible();
        await expect.poll(() => apiState.runRequests.at(-1)?.functionId ?? null).toBe(null);
        await expect.poll(() => (apiState.runRequests.at(-1)?.toolSelection as { toolId?: string } | undefined)?.toolId ?? null).toBe(provisionNativeToolId);
    });

    test('projette dans l editeur l execution immediate d une native readonly sans dependances', async ({ page }) => {
        await openPhilFunctionsPage(page);

                await page.getByText('web_search_py', { exact: true }).click();
        await page.getByRole('button', { name: 'Éditeur' }).click();

        await expect(page.getByText('Aucune preparation supplementaire requise', { exact: true })).toBeVisible();
        await expect(page.getByText('Categorie Native readonly')).toBeVisible();
        await expect(page.getByText('Imports natifs critiques en echec: web_fetch_py')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Préparer build' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Exécuter' })).toBeEnabled();
    });
});