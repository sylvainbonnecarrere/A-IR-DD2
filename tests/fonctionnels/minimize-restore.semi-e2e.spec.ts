import { expect, test, type Route } from '@playwright/test';

const workflowId = '64f000000000000000000001';
const now = '2026-03-29T12:00:00.000Z';
const prototypes = ['a', 'b'].map((suffix, index) => ({
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
const agentInstances = prototypes.map((prototype, index) => {
  const position = { x: 300 + index * 520, y: 200 };
  return {
    id: `64f00000000000000000020${index}`,
    prototypeId: prototype.id,
    workflowId,
    name: prototype.name,
    position,
    chatMessages: [],
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

test('minimize, move and restore avoids overlap with another node', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('auth_data_v1', JSON.stringify({
      user: { id: 'user-reentry', email: 'reentry@test.local', role: 'user' },
      accessToken: 'token',
      refreshToken: 'refresh',
    }));
  });
  const fulfill = (route: Route, body: unknown) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
    headers: { 'access-control-allow-origin': '*' },
  });
  await page.route('**/api/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    const method = route.request().method();
    if (pathname === '/api/user/workspace' && method === 'GET') {
      return fulfill(route, {
        workflow: { id: workflowId, _id: workflowId, name: 'Workflow restore', isActive: true, isDefault: true, isDirty: false, canvasState: { zoom: 1, panX: 0, panY: 0 }, createdAt: now, updatedAt: now },
        nodes: [], edges: [], agentInstances, agentPrototypes: prototypes, llmConfigs: [], toolRuns: [],
        metadata: { userId: 'user-reentry', source: 'api', loadedAt: now, hasWorkflow: true },
      });
    }
    if (pathname === '/api/workflows' && method === 'GET') {
      return fulfill(route, { workflows: [{ _id: workflowId, userId: 'user-reentry', name: 'Workflow restore', isActive: true, isDefault: true, createdAt: now, updatedAt: now }] });
    }
    if (pathname === '/api/llm/get-all-api-keys' || pathname === '/api/local-llm-profiles') return fulfill(route, []);
    if (pathname === '/api/tools') return fulfill(route, { items: [] });
    return fulfill(route, {});
  });

  await page.goto('/');
  const first = page.locator('.react-flow__node').filter({ hasText: 'Agent b' });
  const second = page.locator('.react-flow__node').filter({ hasText: 'Agent a' });
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  await second.getByRole('button', { name: 'Réduire' }).click();
  await expect(second.getByRole('button', { name: 'Taille normale' })).toBeVisible();

  const before = await second.boundingBox();
  const neighbour = await first.boundingBox();
  expect(before).not.toBeNull();
  expect(neighbour).not.toBeNull();
  if (!before || !neighbour) throw new Error('Node geometry unavailable');
  await page.mouse.move(before.x + before.width / 2, before.y + 20);
  await page.mouse.down();
  await page.mouse.move(neighbour.x - before.width / 2 - 10, neighbour.y + 20, { steps: 15 });
  await page.mouse.up();
  await expect.poll(async () => (await second.boundingBox())?.x).not.toBe(before.x);
  const minimized = await second.boundingBox();
  const stationary = await first.boundingBox();
  expect(minimized).not.toBeNull();
  expect(stationary).not.toBeNull();
  if (!minimized || !stationary) throw new Error('Node geometry unavailable after move');
  expect(minimized.x + minimized.width).toBeLessThanOrEqual(stationary.x);
  expect(minimized.x + stationary.width).toBeGreaterThan(stationary.x);
  await second.getByRole('button', { name: 'Taille normale' }).click();
  await expect(second.getByRole('button', { name: 'Réduire' })).toBeVisible();
  await expect.poll(async () => {
    const a = await first.boundingBox();
    const b = await second.boundingBox();
    if (!a || !b) return true;
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  }).toBe(false);
});
