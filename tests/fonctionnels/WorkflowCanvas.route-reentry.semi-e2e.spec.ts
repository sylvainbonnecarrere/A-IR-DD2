import { expect, test, type Page, type Route } from '@playwright/test';

const workflowId = '64f000000000000000000001';
const now = '2026-03-29T12:00:00.000Z';

const prototypes = ['a', 'b', 'c'].map((suffix, index) => ({
    id: `64f00000000000000000010${index}`,
    name: `Agent ${suffix}`,
    description: 'assistant',
    systemPrompt: 'x',
    provider: 'gemini',
    model: 'gemini-2.0-flash',
    capabilities: [],
    tools: [],
    toolSelections: [],
}));

const instances = prototypes.map((prototype, index) => {
    const position = { x: 300 + index * 520, y: 200 + (index % 2) * 380 };
    return {
        id: `64f00000000000000000020${index}`,
        prototypeId: prototype.id,
        workflowId,
        name: prototype.name,
        position,
        isMinimized: false,
        isMaximized: false,
        configuration_json: {
            role: 'assistant',
            model: 'gemini-2.0-flash',
            llmProvider: 'gemini',
            systemPrompt: 'x',
            capabilities: [],
            tools: [],
            toolSelections: [],
            historyConfig: {},
            outputConfig: {},
            position,
        },
    };
});

const workspacePayload = {
    workflow: {
        id: workflowId,
        _id: workflowId,
        name: 'Workflow reentry',
        isActive: true,
        isDefault: true,
        isDirty: false,
        canvasState: { zoom: 1, panX: 0, panY: 0 },
        createdAt: now,
        updatedAt: now,
    },
    nodes: [],
    edges: [],
    agentInstances: instances,
    agentPrototypes: prototypes,
    llmConfigs: [],
    toolRuns: [],
    metadata: { userId: 'user-reentry', source: 'api', loadedAt: now, hasWorkflow: true },
};

const fulfillJson = (route: Route, status: number, body: unknown) => route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
    headers: { 'access-control-allow-origin': '*' },
});

async function installMocks(page: Page) {
    await page.addInitScript(() => {
        localStorage.setItem('auth_data_v1', JSON.stringify({
            user: { id: 'user-reentry', email: 'reentry@test.local', role: 'user' },
            accessToken: 'token',
            refreshToken: 'refresh',
        }));
    });

    await page.route('**/api/**', async (route) => {
        const { pathname } = new URL(route.request().url());
        const method = route.request().method();
        if (pathname === '/api/user/workspace' && method === 'GET') return fulfillJson(route, 200, workspacePayload);
        if (pathname === '/api/workflows' && method === 'GET') {
            return fulfillJson(route, 200, {
                workflows: [{ _id: workflowId, userId: 'user-reentry', name: 'Workflow reentry', isActive: true, isDefault: true, createdAt: now, updatedAt: now }],
            });
        }
        if (pathname === '/api/llm/get-all-api-keys') return fulfillJson(route, 200, []);
        if (pathname === '/api/local-llm-profiles') return fulfillJson(route, 200, []);
        if (pathname === '/api/tools') return fulfillJson(route, 200, { items: [] });
        return fulfillJson(route, 200, {});
    });
}

async function snapshot(page: Page) {
    return page.evaluate(() => {
        const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | null;
        const nodes = Array.from(document.querySelectorAll('.react-flow__node')).map((el) => {
            const rect = el.getBoundingClientRect();
            return { id: el.getAttribute('data-id'), x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width) };
        });
        return { transform: viewport?.style.transform ?? null, nodes };
    });
}

test('les nodes gardent la meme position apres navigation vers un autre ecran et retour sur la carte', async ({ page }) => {
    await installMocks(page);
    page.on('console', (msg) => { if (msg.text().includes('DBGFIT')) console.log(msg.text()); });
    await page.goto('/');
    await page.waitForSelector('.react-flow__node', { timeout: 30_000 });
    await page.waitForTimeout(1500);
    const before = await snapshot(page);
    console.log('BEFORE', JSON.stringify(before));
    expect(before.nodes.length).toBe(3);

    for (let i = 0; i < 2; i += 1) {
        await page.getByRole('button', { name: 'Phil' }).click();
        await page.getByRole('button', { name: 'Fonctions Personnalisées' }).click();
        await page.waitForTimeout(800);
        await page.getByRole('button', { name: 'Bos' }).click();
        await page.getByRole('button', { name: 'Carte du workflow' }).click();
        await page.waitForSelector('.react-flow__node', { timeout: 30_000 });
        await page.waitForTimeout(1500);
        const after = await snapshot(page);
        console.log(`AFTER${i}`, JSON.stringify(after));
        expect(after.nodes).toEqual(before.nodes);
        expect(after.transform).toBe(before.transform);
    }
});
