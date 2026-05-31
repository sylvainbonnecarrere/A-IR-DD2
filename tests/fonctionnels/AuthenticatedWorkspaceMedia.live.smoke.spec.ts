import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const BACKEND_URL = 'http://127.0.0.1:3001';
const PASSWORD = 'Password123';
const ROBOT_ID = 'AR_001';

type StoredAuthData = {
    user: {
        id: string;
        email: string;
        role: string;
    };
    accessToken: string;
    refreshToken: string;
};

type RegisterResponse = StoredAuthData;

type WorkspaceResponse = {
    workflow: {
        id?: string;
        _id?: string;
        name: string;
    } | null;
    metadata?: {
        hasWorkflow?: boolean;
    };
};

type WorkflowMediaExplorerItem = {
    mediaId: string;
    originalName: string;
    displayName: string;
    storageMode: 'db' | 'workspace' | 'cloud';
    provenance?: 'user' | 'agent' | 'function' | 'import' | 'runtime_output' | null;
    sourceExecutionId?: string | null;
    canonicalLocator: string;
    mimeType: string;
    size: number;
    isOrphan: boolean;
    orphanReason?: string | null;
};

type SandboxHealthResponse = {
    capabilities?: {
        run?: {
            python?: boolean;
        };
    };
};

type ToolCreateResponse = {
    tool?: {
        id?: string;
        _id?: string;
    };
};

type SandboxRunResponse = {
    success: boolean;
    executionId?: string;
    metadata?: {
        artifacts?: Array<{
            path: string;
            kind: string;
        }>;
    };
};

const RUNTIME_ARTIFACT_TOOL_CODE = [
    'import json',
    'import os',
    'from pathlib import Path',
    '',
    'def run(context, args):',
    '    output_root = os.environ.get("PERSISTENT_WORKSPACE_OUTPUT_ROOT")',
    '    if not output_root:',
    '        raise RuntimeError("PERSISTENT_WORKSPACE_OUTPUT_ROOT missing")',
    '    file_name = args.get("file_name") or f"{context.sessionId}.json"',
    '    marker = args.get("marker") or "runtime-bos-e2e"',
    '    artifact_dir = Path(output_root) / "e2e-runtime"',
    '    artifact_dir.mkdir(parents=True, exist_ok=True)',
    '    artifact_path = artifact_dir / file_name',
    '    payload = {"marker": marker, "executionId": context.sessionId, "workflowId": context.workflowId}',
    '    artifact_path.write_text(json.dumps(payload), encoding="utf-8")',
    '    return payload',
].join('\n');

function buildQaEmail(): string {
    const stamp = Date.now();
    const suffix = Math.random().toString(36).slice(2, 8);
    return `workspace-media-e2e-${stamp}-${suffix}@test.com`;
}

async function expectOk(response: Awaited<ReturnType<APIRequestContext['get']>> | Awaited<ReturnType<APIRequestContext['post']>> | Awaited<ReturnType<APIRequestContext['put']>>, context: string) {
    expect(response.ok(), `${context} failed with HTTP ${response.status()}`).toBeTruthy();
}

async function createAuthenticatedWorkspaceFixture(request: APIRequestContext, params: {
    prototypeName: string;
    instanceName: string;
    saveMode?: 'auto' | 'manual';
    llmProvider?: string;
    llmModel?: string;
    capabilities?: string[];
    mediaStorage?: 'db' | 'workspace' | 'cloud';
}) {
    const email = buildQaEmail();

    const registerResponse = await request.post(`${BACKEND_URL}/api/auth/register`, {
        data: {
            email,
            password: PASSWORD,
        },
    });
    await expectOk(registerResponse, 'Register user');
    const registerPayload = await registerResponse.json() as RegisterResponse;

    const authHeaders = {
        Authorization: `Bearer ${registerPayload.accessToken}`,
        'Content-Type': 'application/json',
        'X-Robot-Id': ROBOT_ID,
    };

    const saveModeResponse = await request.put(`${BACKEND_URL}/api/user-settings`, {
        headers: authHeaders,
        data: {
            preferences: {
                language: 'fr',
                theme: 'dark',
                saveMode: params.saveMode ?? 'auto',
            },
        },
    });
    await expectOk(saveModeResponse, 'Set save mode auto');

    const workspaceResponse = await request.get(`${BACKEND_URL}/api/user/workspace`, {
        headers: authHeaders,
    });
    await expectOk(workspaceResponse, 'Load user workspace');
    const workspacePayload = await workspaceResponse.json() as WorkspaceResponse;

    expect(workspacePayload.metadata?.hasWorkflow).toBe(true);
    const workflowId = String(workspacePayload.workflow?.id ?? workspacePayload.workflow?._id ?? '');
    expect(workflowId).not.toBe('');

    const prototypeResponse = await request.post(`${BACKEND_URL}/api/agent-prototypes`, {
        headers: authHeaders,
        data: {
            name: params.prototypeName,
            role: 'Archiviste workspace',
            systemPrompt: 'Analyse les fichiers et conserve les pièces jointes dans le workspace.',
            llmProvider: params.llmProvider ?? 'Mistral',
            llmModel: params.llmModel ?? 'mistral-small-latest',
            capabilities: params.capabilities ?? ['Chat', 'File Analysis'],
            tools: [],
            workflowId,
            robotId: ROBOT_ID,
            persistenceConfig: {
                saveChat: true,
                saveErrors: true,
                saveHistorySummary: false,
                saveLinks: false,
                saveTasks: false,
                saveMedia: true,
                mediaStorage: params.mediaStorage ?? 'workspace',
                allowWorkspaceWrite: true,
            },
        },
    });
    await expectOk(prototypeResponse, 'Create prototype');
    const prototypePayload = await prototypeResponse.json() as { id?: string; _id?: string };
    const prototypeId = String(prototypePayload.id ?? prototypePayload._id ?? '');
    expect(prototypeId).not.toBe('');

    const instanceResponse = await request.post(`${BACKEND_URL}/api/workflows/${workflowId}/instances/from-prototype`, {
        headers: authHeaders,
        data: {
            prototypeId,
            name: params.instanceName,
            position: { x: 240, y: 180 },
            persistenceConfig: {
                saveChat: true,
                saveErrors: true,
                saveHistorySummary: false,
                saveLinks: false,
                saveTasks: false,
                saveMedia: true,
                mediaStorage: params.mediaStorage ?? 'workspace',
                allowWorkspaceWrite: true,
            },
        },
    });
    await expectOk(instanceResponse, 'Create instance from prototype');
    const instancePayload = await instanceResponse.json() as { id: string };

    return {
        authData: {
            user: registerPayload.user,
            accessToken: registerPayload.accessToken,
            refreshToken: registerPayload.refreshToken,
        } satisfies StoredAuthData,
        accessToken: registerPayload.accessToken,
        workflowId,
        prototypeId,
        instanceId: instancePayload.id,
        email,
    };
}

async function waitForUserSettingsLoad(page: Page) {
    await page.waitForResponse((response) => (
        response.url().includes('/api/user-settings')
        && response.request().method() === 'GET'
        && response.ok()
    ));
}

async function gotoAndWaitForUserSettings(page: Page) {
    await Promise.all([
        waitForUserSettingsLoad(page),
        page.goto('/'),
    ]);
}

async function openWorkflowMediaModal(page: Page) {
    await page.getByRole('button', { name: 'Gestion des fichiers' }).click();

    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();
    await expect(modal.getByText('Media du workflow')).toBeVisible();
    return modal;
}

async function findExplorerItem(
    request: APIRequestContext,
    accessToken: string,
    workflowId: string,
    fileName: string,
    storageMode: 'db' | 'workspace' | 'cloud' = 'workspace',
): Promise<WorkflowMediaExplorerItem | null> {
    const response = await request.get(`${BACKEND_URL}/api/media/workflows/${workflowId}/explorer?storageMode=${storageMode}&includeOrphans=true`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    if (!response.ok()) {
        return null;
    }

    const payload = await response.json() as { data?: WorkflowMediaExplorerItem[] };
    return payload.data?.find((item) => item.originalName === fileName) ?? null;
}

async function isPythonSandboxExecutionReady(request: APIRequestContext, accessToken: string): Promise<boolean> {
    const response = await request.get(`${BACKEND_URL}/api/sandbox/health`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    if (!response.ok()) {
        return false;
    }

    const payload = await response.json() as SandboxHealthResponse;
    return payload.capabilities?.run?.python === true;
}

async function createWorkflowScopedRuntimeTool(request: APIRequestContext, params: {
    accessToken: string;
    workflowId: string;
    toolName: string;
}): Promise<string> {
    const response = await request.post(`${BACKEND_URL}/api/tools`, {
        headers: {
            Authorization: `Bearer ${params.accessToken}`,
            'Content-Type': 'application/json',
        },
        data: {
            name: params.toolName,
            description: 'Runtime smoke test tool that writes a JSON artifact to the workflow output root.',
            runtime: 'python',
            workflowId: params.workflowId,
            codeInline: RUNTIME_ARTIFACT_TOOL_CODE,
            tags: ['e2e', 'runtime', 'media'],
            dependencies: [],
        },
    });
    await expectOk(response, 'Create workflow-scoped runtime tool');

    const payload = await response.json() as ToolCreateResponse;
    const toolId = String(payload.tool?.id ?? payload.tool?._id ?? '');
    expect(toolId).not.toBe('');
    return toolId;
}

test.describe('Authenticated workspace media live', () => {
    test('persists a text attachment to workspace and exposes it in BOS Media', async ({ page, request }) => {
        test.slow();

        const stamp = Date.now();
        const prototypeName = `Prototype Workspace ${stamp}`;
        const instanceName = `Instance Workspace ${stamp}`;
        const fileName = `workspace-proof-${stamp}.txt`;
        const fileContent = `workspace e2e payload ${stamp}`;
        const chatPrompt = 'Conserve ce fichier texte dans le workspace du workflow.';
        const hookErrors: string[] = [];

        const fixture = await createAuthenticatedWorkspaceFixture(request, {
            prototypeName,
            instanceName,
        });

        page.on('pageerror', (error) => {
            hookErrors.push(error.message);
        });

        page.on('console', (message) => {
            if (message.type() === 'error') {
                hookErrors.push(message.text());
            }
        });

        await page.addInitScript((authData: StoredAuthData) => {
            window.localStorage.setItem('auth_data_v1', JSON.stringify(authData));
        }, fixture.authData);

        await gotoAndWaitForUserSettings(page);

        await expect(page.getByText(instanceName)).toBeVisible({ timeout: 20_000 });

        const textarea = page.locator('textarea').first();
        const fileInput = page.locator('input[type="file"]').first();

        await textarea.fill(chatPrompt);
        await fileInput.setInputFiles({
            name: fileName,
            mimeType: 'text/plain',
            buffer: Buffer.from(fileContent, 'utf-8'),
        });

        await expect(page.getByText(fileName)).toBeVisible();

        const journalResponsePromise = page.waitForResponse((response) => (
            response.url().includes(`/api/workflows/${fixture.workflowId}/instances/${fixture.instanceId}/journal`)
            && response.request().method() === 'POST'
        ));

        await textarea.focus();
        await textarea.press('Enter');

        const journalResponse = await journalResponsePromise;
        expect(journalResponse.ok()).toBeTruthy();

        const journalRequestPayload = journalResponse.request().postDataJSON() as {
            type: string;
            payload: Record<string, unknown>;
        };

        expect(journalRequestPayload.type).toBe('chat');
        expect(journalRequestPayload.payload).toEqual(expect.objectContaining({
            role: 'user',
            content: chatPrompt,
            fileName,
            mimeType: 'text/plain',
            fileContent,
        }));

        await expect.poll(async () => {
            const item = await findExplorerItem(request, fixture.accessToken, fixture.workflowId, fileName);
            return item?.storageMode ?? null;
        }, {
            timeout: 20_000,
            message: 'Expected the uploaded text file to be indexed as workspace media.',
        }).toBe('workspace');

        const explorerItem = await findExplorerItem(request, fixture.accessToken, fixture.workflowId, fileName);
        expect(explorerItem).not.toBeNull();
        expect(explorerItem?.canonicalLocator).toContain('workspace://');
        expect(explorerItem?.mimeType).toBe('text/plain');

        const mediaResponse = await request.get(`${BACKEND_URL}/api/media/${explorerItem!.mediaId}`, {
            headers: {
                Authorization: `Bearer ${fixture.accessToken}`,
            },
        });
        await expectOk(mediaResponse, 'Fetch persisted media blob');
        expect(await mediaResponse.text()).toBe(fileContent);

        const modal = await openWorkflowMediaModal(page);
        await expect(modal.getByText(fileName)).toBeVisible();

        const bosHookErrors = hookErrors.filter((message) => (
            /change in the order of Hooks called by BosMediaModal/i.test(message)
            || /Rendered more hooks than during the previous render/i.test(message)
        ));

        expect(bosHookErrors).toEqual([]);
    });

    test('persists a text attachment to db storage and exposes it in BOS Media', async ({ page, request }) => {
        test.slow();

        const stamp = Date.now();
        const prototypeName = `Prototype DB ${stamp}`;
        const instanceName = `Instance DB ${stamp}`;
        const fileName = `db-proof-${stamp}.txt`;
        const fileContent = `db e2e payload ${stamp}`;
        const chatPrompt = 'Conserve ce fichier texte en stockage BDD.';
        const hookErrors: string[] = [];

        const fixture = await createAuthenticatedWorkspaceFixture(request, {
            prototypeName,
            instanceName,
            mediaStorage: 'db',
        });

        page.on('pageerror', (error) => {
            hookErrors.push(error.message);
        });

        page.on('console', (message) => {
            if (message.type() === 'error') {
                hookErrors.push(message.text());
            }
        });

        await page.addInitScript((authData: StoredAuthData) => {
            window.localStorage.setItem('auth_data_v1', JSON.stringify(authData));
        }, fixture.authData);

        await gotoAndWaitForUserSettings(page);

        await expect(page.getByText(instanceName)).toBeVisible({ timeout: 20_000 });

        const textarea = page.locator('textarea').first();
        const fileInput = page.locator('input[type="file"]').first();

        await textarea.fill(chatPrompt);
        await fileInput.setInputFiles({
            name: fileName,
            mimeType: 'text/plain',
            buffer: Buffer.from(fileContent, 'utf-8'),
        });

        await expect(page.getByText(fileName)).toBeVisible();

        const journalResponsePromise = page.waitForResponse((response) => (
            response.url().includes(`/api/workflows/${fixture.workflowId}/instances/${fixture.instanceId}/journal`)
            && response.request().method() === 'POST'
        ));

        await textarea.focus();
        await textarea.press('Enter');

        const journalResponse = await journalResponsePromise;
        expect(journalResponse.ok()).toBeTruthy();

        await expect.poll(async () => {
            const item = await findExplorerItem(request, fixture.accessToken, fixture.workflowId, fileName, 'db');
            return item?.storageMode ?? null;
        }, {
            timeout: 20_000,
            message: 'Expected the uploaded text file to be indexed as db media.',
        }).toBe('db');

        const explorerItem = await findExplorerItem(request, fixture.accessToken, fixture.workflowId, fileName, 'db');
        expect(explorerItem).not.toBeNull();
        expect(explorerItem?.canonicalLocator).toContain('journal://');
        expect(explorerItem?.mimeType).toBe('text/plain');

        const mediaResponse = await request.get(`${BACKEND_URL}/api/media/${explorerItem!.mediaId}`, {
            headers: {
                Authorization: `Bearer ${fixture.accessToken}`,
            },
        });
        await expectOk(mediaResponse, 'Fetch persisted db media blob');
        expect(await mediaResponse.text()).toBe(fileContent);

        const modal = await openWorkflowMediaModal(page);
        await modal.getByRole('button', { name: /BDD/ }).click();
        await expect(modal.getByText(fileName)).toBeVisible();

        const bosHookErrors = hookErrors.filter((message) => (
            /change in the order of Hooks called by BosMediaModal/i.test(message)
            || /Rendered more hooks than during the previous render/i.test(message)
        ));

        expect(bosHookErrors).toEqual([]);
    });

    test('persists a Gemini File Analysis import to workspace on manual save before send', async ({ page, request }) => {
        test.slow();

        const stamp = Date.now();
        const prototypeName = `Prototype Workspace Manual ${stamp}`;
        const instanceName = `Instance Workspace Manual ${stamp}`;
        const fileName = `workspace-draft-${stamp}.txt`;
        const fileContent = `workspace draft payload ${stamp}`;
        const hookErrors: string[] = [];

        const fixture = await createAuthenticatedWorkspaceFixture(request, {
            prototypeName,
            instanceName,
            saveMode: 'manual',
            llmProvider: 'Gemini',
            llmModel: 'gemini-2.0-flash',
        });

        page.on('pageerror', (error) => {
            hookErrors.push(error.message);
        });

        page.on('console', (message) => {
            if (message.type() === 'error') {
                hookErrors.push(message.text());
            }
        });

        await page.addInitScript((authData: StoredAuthData) => {
            window.localStorage.setItem('auth_data_v1', JSON.stringify(authData));
        }, fixture.authData);

        await gotoAndWaitForUserSettings(page);

        await expect(page.getByText(instanceName)).toBeVisible({ timeout: 20_000 });
        const saveButton = page.getByRole('button', { name: 'Save prototype workflow' });
        await expect(saveButton).toBeVisible();

        const fileInput = page.locator('input[type="file"]').first();
        await fileInput.setInputFiles({
            name: fileName,
            mimeType: 'text/plain',
            buffer: Buffer.from(fileContent, 'utf-8'),
        });

        await expect(page.getByText(fileName)).toBeVisible();

        const importedMediaResponsePromise = page.waitForResponse((response) => (
            response.url().includes(`/api/workflows/${fixture.workflowId}/instances/${fixture.instanceId}/imported-media`)
            && response.request().method() === 'POST'
        ));

        await saveButton.click();

        const importedMediaResponse = await importedMediaResponsePromise;
        expect(importedMediaResponse.ok()).toBeTruthy();

        const importedMediaRequestPayload = importedMediaResponse.request().postDataJSON() as {
            attachmentId: string;
            fileName: string;
            mimeType: string;
            contentBase64: string;
            origin: string;
        };

        expect(importedMediaRequestPayload).toEqual(expect.objectContaining({
            fileName,
            mimeType: 'text/plain',
            origin: 'llm_file_upload',
        }));

        await expect.poll(async () => {
            const item = await findExplorerItem(request, fixture.accessToken, fixture.workflowId, fileName, 'workspace');
            return item?.storageMode ?? null;
        }, {
            timeout: 20_000,
            message: 'Expected the manually saved draft import to be indexed as workspace media.',
        }).toBe('workspace');

        const explorerItem = await findExplorerItem(request, fixture.accessToken, fixture.workflowId, fileName, 'workspace');
        expect(explorerItem).not.toBeNull();
        expect(explorerItem?.canonicalLocator).toContain('workspace://');
        expect(explorerItem?.mimeType).toBe('text/plain');

        const mediaResponse = await request.get(`${BACKEND_URL}/api/media/${explorerItem!.mediaId}`, {
            headers: {
                Authorization: `Bearer ${fixture.accessToken}`,
            },
        });
        await expectOk(mediaResponse, 'Fetch manually saved draft media blob');
        expect(await mediaResponse.text()).toBe(fileContent);

        const modal = await openWorkflowMediaModal(page);
        await expect(modal.getByText(fileName)).toBeVisible();

        const bosHookErrors = hookErrors.filter((message) => (
            /change in the order of Hooks called by BosMediaModal/i.test(message)
            || /Rendered more hooks than during the previous render/i.test(message)
        ));

        expect(bosHookErrors).toEqual([]);
    });

    test('projects a real runtime artifact into BOS Media after authenticated sandbox execution', async ({ page, request }) => {
        test.slow();

        const stamp = Date.now();
        const prototypeName = `Prototype Runtime ${stamp}`;
        const instanceName = `Instance Runtime ${stamp}`;
        const fileName = `runtime-artifact-${stamp}.json`;
        const toolName = `runtime_media_${stamp}`;
        const hookErrors: string[] = [];

        const fixture = await createAuthenticatedWorkspaceFixture(request, {
            prototypeName,
            instanceName,
            mediaStorage: 'workspace',
        });

        test.skip(
            !(await isPythonSandboxExecutionReady(request, fixture.accessToken)),
            'Python sandbox runtime is not ready in this environment.',
        );

        const toolId = await createWorkflowScopedRuntimeTool(request, {
            accessToken: fixture.accessToken,
            workflowId: fixture.workflowId,
            toolName,
        });

        const runResponse = await request.post(`${BACKEND_URL}/api/sandbox/run`, {
            headers: {
                Authorization: `Bearer ${fixture.accessToken}`,
                'Content-Type': 'application/json',
            },
            data: {
                functionId: toolId,
                agentInstanceId: fixture.instanceId,
                testArgs: {
                    file_name: fileName,
                    marker: `runtime-bos-${stamp}`,
                },
            },
        });
        await expectOk(runResponse, 'Run workflow-scoped runtime tool');

        const runPayload = await runResponse.json() as SandboxRunResponse;
        expect(runPayload.success).toBe(true);
        expect(runPayload.executionId).toBeTruthy();
        expect(runPayload.metadata?.artifacts).toEqual(expect.arrayContaining([
            expect.objectContaining({
                path: `output/e2e-runtime/${fileName}`,
            }),
        ]));

        await expect.poll(async () => {
            const item = await findExplorerItem(request, fixture.accessToken, fixture.workflowId, fileName, 'workspace');
            if (!item) {
                return null;
            }

            return `${item.provenance ?? 'null'}:${item.sourceExecutionId ?? 'null'}`;
        }, {
            timeout: 20_000,
            message: 'Expected the runtime artifact to be projected into BOS Media.',
        }).toBe(`runtime_output:${runPayload.executionId}`);

        const explorerItem = await findExplorerItem(request, fixture.accessToken, fixture.workflowId, fileName, 'workspace');
        expect(explorerItem).not.toBeNull();
        expect(explorerItem?.canonicalLocator).toContain(`workspace://output/e2e-runtime/${fileName}`);

        page.on('pageerror', (error) => {
            hookErrors.push(error.message);
        });

        page.on('console', (message) => {
            if (message.type() === 'error') {
                hookErrors.push(message.text());
            }
        });

        await page.addInitScript((authData: StoredAuthData) => {
            window.localStorage.setItem('auth_data_v1', JSON.stringify(authData));
        }, fixture.authData);

        await gotoAndWaitForUserSettings(page);

        await expect(page.getByText(instanceName)).toBeVisible({ timeout: 20_000 });
        const modal = await openWorkflowMediaModal(page);
        await expect(modal.getByText(fileName, { exact: true }).first()).toBeVisible();
        await expect(modal.getByText('Artefact runtime')).toBeVisible();
        await expect(modal.getByText(new RegExp(runPayload.executionId ?? ''))).toBeVisible();

        const bosHookErrors = hookErrors.filter((message) => (
            /change in the order of Hooks called by BosMediaModal/i.test(message)
            || /Rendered more hooks than during the previous render/i.test(message)
        ));

        expect(bosHookErrors).toEqual([]);
    });

    test('keeps media visible as orphaned after deleting the instance with orphan_media', async ({ page, request }) => {
        test.slow();

        const stamp = Date.now();
        const prototypeName = `Prototype Orphan ${stamp}`;
        const instanceName = `Instance Orphan ${stamp}`;
        const fileName = `orphan-proof-${stamp}.txt`;
        const fileContent = `orphan e2e payload ${stamp}`;

        const fixture = await createAuthenticatedWorkspaceFixture(request, {
            prototypeName,
            instanceName,
            mediaStorage: 'workspace',
        });

        await page.addInitScript((authData: StoredAuthData) => {
            window.localStorage.setItem('auth_data_v1', JSON.stringify(authData));
        }, fixture.authData);

        await gotoAndWaitForUserSettings(page);

        await expect(page.getByText(instanceName)).toBeVisible({ timeout: 20_000 });

        const textarea = page.locator('textarea').first();
        const fileInput = page.locator('input[type="file"]').first();

        await textarea.fill('Conserve ce fichier pour verifier l orphelinisation.');
        await fileInput.setInputFiles({
            name: fileName,
            mimeType: 'text/plain',
            buffer: Buffer.from(fileContent, 'utf-8'),
        });

        const journalResponsePromise = page.waitForResponse((response) => (
            response.url().includes(`/api/workflows/${fixture.workflowId}/instances/${fixture.instanceId}/journal`)
            && response.request().method() === 'POST'
        ));

        await textarea.focus();
        await textarea.press('Enter');

        const journalResponse = await journalResponsePromise;
        expect(journalResponse.ok()).toBeTruthy();

        await expect.poll(async () => {
            const item = await findExplorerItem(request, fixture.accessToken, fixture.workflowId, fileName, 'workspace');
            return item?.mediaId ?? null;
        }, {
            timeout: 20_000,
            message: 'Expected the uploaded text file to be indexed before orphan deletion.',
        }).not.toBeNull();

        const explorerItemBeforeDelete = await findExplorerItem(request, fixture.accessToken, fixture.workflowId, fileName, 'workspace');
        expect(explorerItemBeforeDelete).not.toBeNull();

        const deleteResponse = await request.delete(`${BACKEND_URL}/api/workflows/${fixture.workflowId}/instances/${fixture.instanceId}?mediaPolicy=orphan_media`, {
            headers: {
                Authorization: `Bearer ${fixture.accessToken}`,
            },
        });
        expect(deleteResponse.ok(), `Delete instance with orphan_media failed with HTTP ${deleteResponse.status()}`).toBeTruthy();

        const deletePayload = await deleteResponse.json() as {
            mediaPolicy: string;
            cascadeDelete?: {
                mediaReferencesOrphaned?: number;
            };
        };

        expect(deletePayload.mediaPolicy).toBe('orphan_media');
        expect(deletePayload.cascadeDelete?.mediaReferencesOrphaned).toBeGreaterThanOrEqual(1);

        await expect.poll(async () => {
            const item = await findExplorerItem(request, fixture.accessToken, fixture.workflowId, fileName, 'workspace');
            if (!item) {
                return null;
            }

            return item.isOrphan ? item.orphanReason ?? 'orphan-without-reason' : null;
        }, {
            timeout: 20_000,
            message: 'Expected the media to remain visible as orphaned after instance deletion.',
        }).toBe('agent_deleted');

        const explorerItemAfterDelete = await findExplorerItem(request, fixture.accessToken, fixture.workflowId, fileName, 'workspace');
        expect(explorerItemAfterDelete).not.toBeNull();
        expect(explorerItemAfterDelete?.isOrphan).toBe(true);
        expect(explorerItemAfterDelete?.orphanReason).toBe('agent_deleted');

        const mediaResponse = await request.get(`${BACKEND_URL}/api/media/${explorerItemBeforeDelete!.mediaId}`, {
            headers: {
                Authorization: `Bearer ${fixture.accessToken}`,
            },
        });
        expect(mediaResponse.ok(), `Fetch orphaned media failed with HTTP ${mediaResponse.status()}`).toBeTruthy();
        expect(await mediaResponse.text()).toBe(fileContent);
    });

    test('physically removes media after deleting the instance with delete_media', async ({ page, request }) => {
        test.slow();

        const stamp = Date.now();
        const prototypeName = `Prototype Delete ${stamp}`;
        const instanceName = `Instance Delete ${stamp}`;
        const fileName = `delete-proof-${stamp}.txt`;
        const fileContent = `delete e2e payload ${stamp}`;

        const fixture = await createAuthenticatedWorkspaceFixture(request, {
            prototypeName,
            instanceName,
            mediaStorage: 'workspace',
        });

        await page.addInitScript((authData: StoredAuthData) => {
            window.localStorage.setItem('auth_data_v1', JSON.stringify(authData));
        }, fixture.authData);

        await gotoAndWaitForUserSettings(page);

        await expect(page.getByText(instanceName)).toBeVisible({ timeout: 20_000 });

        const textarea = page.locator('textarea').first();
        const fileInput = page.locator('input[type="file"]').first();

        await textarea.fill('Conserve ce fichier pour verifier la suppression physique.');
        await fileInput.setInputFiles({
            name: fileName,
            mimeType: 'text/plain',
            buffer: Buffer.from(fileContent, 'utf-8'),
        });

        const journalResponsePromise = page.waitForResponse((response) => (
            response.url().includes(`/api/workflows/${fixture.workflowId}/instances/${fixture.instanceId}/journal`)
            && response.request().method() === 'POST'
        ));

        await textarea.focus();
        await textarea.press('Enter');

        const journalResponse = await journalResponsePromise;
        expect(journalResponse.ok()).toBeTruthy();

        await expect.poll(async () => {
            const item = await findExplorerItem(request, fixture.accessToken, fixture.workflowId, fileName, 'workspace');
            return item?.mediaId ?? null;
        }, {
            timeout: 20_000,
            message: 'Expected the uploaded text file to be indexed before delete_media.',
        }).not.toBeNull();

        const explorerItemBeforeDelete = await findExplorerItem(request, fixture.accessToken, fixture.workflowId, fileName, 'workspace');
        expect(explorerItemBeforeDelete).not.toBeNull();

        const deleteResponse = await request.delete(`${BACKEND_URL}/api/workflows/${fixture.workflowId}/instances/${fixture.instanceId}?mediaPolicy=delete_media`, {
            headers: {
                Authorization: `Bearer ${fixture.accessToken}`,
            },
        });
        expect(deleteResponse.ok(), `Delete instance with delete_media failed with HTTP ${deleteResponse.status()}`).toBeTruthy();

        const deletePayload = await deleteResponse.json() as {
            mediaPolicy: string;
            cascadeDelete?: {
                mediaReferencesDeleted?: number;
            };
        };

        expect(deletePayload.mediaPolicy).toBe('delete_media');
        expect(deletePayload.cascadeDelete?.mediaReferencesDeleted).toBeGreaterThanOrEqual(1);

        await expect.poll(async () => {
            const item = await findExplorerItem(request, fixture.accessToken, fixture.workflowId, fileName, 'workspace');
            return item ?? null;
        }, {
            timeout: 20_000,
            message: 'Expected the media to disappear from the explorer after delete_media.',
        }).toBeNull();

        const mediaResponse = await request.get(`${BACKEND_URL}/api/media/${explorerItemBeforeDelete!.mediaId}`, {
            headers: {
                Authorization: `Bearer ${fixture.accessToken}`,
            },
        });
        expect(mediaResponse.status()).toBe(404);
    });
});