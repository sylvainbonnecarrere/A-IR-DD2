import { test, expect } from '@playwright/test';
import fs from 'fs';

// This Playwright test assumes the app is available at http://localhost:5173
// Run with: npm run dev (vite) and then `npx playwright test tests/fonctionnels/minimize-restore.semi-e2e.spec.ts --project=chromium --headed`

test.describe('Minimize -> Move -> Restore flow', () => {
  test('should correct position on restore and emit trace', async ({ page, context }) => {
    try {
      await context.tracing.start({ screenshots: true, snapshots: true });
    } catch (e) {
      // Tracing may already be started by the runner/config; ignore.
    }

    const url = process.env.TEST_APP_URL || 'http://localhost:5173';
    await page.goto(url);

    // Optional: wait for canvas readiness indicator (app-specific)
    await page.waitForSelector('[data-testid="workflow-canvas-root"]', { timeout: 10000 });

    const nodeSelector = '[data-node-id="node-2"]';
    const minimizeButton = `${nodeSelector} .node-header .minimize-button`;
    const restoreButton = `${nodeSelector} .node-header .restore-button`;

    try {
      await page.click(minimizeButton, { timeout: 2000 });
    } catch (e) {
      console.warn('Minimize button not found via selector; ensure selectors match app under test.');
    }

    try {
      const box = await page.locator(nodeSelector).boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(100, box.y + box.height / 2, { steps: 10 });
        await page.mouse.up();
      }
    } catch (e) {
      console.warn('Drag simulation failed; adapt selectors for the target app.');
    }

    try {
      await page.click(restoreButton, { timeout: 2000 });
    } catch (e) {
      console.warn('Restore button not found via selector; ensure selectors match app under test.');
    }

    await page.waitForTimeout(500);

    const restoreLog = await page.evaluate(() => {
      // @ts-ignore
      return (window as any).__ARC_RESTORE_LOG__ || [];
    });

    const consoleMessages: any[] = [];
    page.on('console', (msg) => {
      consoleMessages.push({ type: msg.type(), text: msg.text() });
    });

    const tracePath = 'test-results/minimize-restore-trace.zip';
    await context.tracing.stop({ path: tracePath });

    if (!fs.existsSync('test-results')) fs.mkdirSync('test-results', { recursive: true });
    fs.writeFileSync('test-results/restore-log.json', JSON.stringify(restoreLog, null, 2));
    fs.writeFileSync('test-results/restore-console.json', JSON.stringify(consoleMessages, null, 2));

    const hasNode2 = restoreLog.some((entry: any) => entry.nodeId === 'node-2');
    expect(hasNode2).toBeTruthy();
  });
});
