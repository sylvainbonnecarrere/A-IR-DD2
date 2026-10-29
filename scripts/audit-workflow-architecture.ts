import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const strictMode = process.argv.includes('--strict');
const targetPattern = /Workflow\.nodes|Workflow\.edges|workflowNodes|workflowEdges|agentInstances|canvasState|saveWorkflow|hydrateWorkspace|persistWorkflow/g;
const allowedExtensions = new Set(['.ts', '.tsx', '.js', '.md']);
const ignoredDirectories = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  'test-results',
  'playwright-report',
  'screenshots'
]);
const protectedLegacyWriteFiles = new Set([
  'backend/src/routes/workflows.routes.ts',
  'services/workspacePersistenceService.ts'
]);

/** @typedef {'V1_READ' | 'V1_WRITE' | 'V2_READ' | 'V2_WRITE' | 'COMPATIBILITY' | 'MIGRATION' | 'TEST_ONLY' | 'UNKNOWN'} Classification */

/**
 * @param {string} relPath
 */
function isTestOnlyPath(relPath) {
  return relPath.startsWith('tests/')
    || relPath.startsWith('backend/src/__tests__/')
    || relPath.startsWith('backend/__tests__/')
    || relPath.includes('.test.');
}

/**
 * @param {string} relPath
 */
function isDocumentationPath(relPath) {
  return relPath === 'README.md'
    || relPath === 'DOCUMENTATION_MAP.md'
    || relPath.startsWith('Guides/')
    || relPath.startsWith('backend/documentation/');
}

/**
 * @param {string} relPath
 * @param {string} lineText
 * @returns {{ classification: Classification, reason: string, surface: string }}
 */
function classifyOccurrence(relPath, lineText) {
  if (isTestOnlyPath(relPath)) {
    return {
      classification: 'TEST_ONLY',
      surface: 'tests-fixtures',
      reason: 'Fixture, test, or regression harness only.'
    };
  }

  if (isDocumentationPath(relPath)) {
    const classification = relPath.includes('/refonte/') || relPath.includes('architecture-v1-v2-migration-plan')
      ? 'MIGRATION'
      : 'COMPATIBILITY';

    return {
      classification,
      surface: 'documentation',
      reason: 'Versioned architecture or compatibility documentation.'
    };
  }

  if (relPath === 'backend/src/routes/workflows.routes.ts') {
    if (/Workflow\.nodes|nodes\.\$\.position|\/nodes\/:nodeId\/position/.test(lineText)) {
      return {
        classification: 'V1_WRITE',
        surface: 'legacy-workflow-route',
        reason: 'Legacy workflow node mutation on Workflow.nodes[].'
      };
    }

    if (/Workflow\.edges|\$push:\s*\{\s*edges|\$pull:\s*\{\s*edges|\/edges/.test(lineText)) {
      return {
        classification: 'V1_WRITE',
        surface: 'legacy-workflow-route',
        reason: 'Legacy workflow edge mutation on Workflow.edges[].'
      };
    }

    if (/canvasState|agentInstances/.test(lineText)) {
      return {
        classification: 'COMPATIBILITY',
        surface: 'workflow-route-mixed-surface',
        reason: 'Mixed workflow route surface bridging V2 and transitional payloads.'
      };
    }

    return {
      classification: 'COMPATIBILITY',
      surface: 'workflow-route-mixed-surface',
      reason: 'Workflow route still mixes V2 and transitional workflow payload handling.'
    };
  }

  if (relPath === 'backend/src/routes/agent-instances.routes.ts') {
    return {
      classification: /agentInstances/.test(lineText) ? 'V2_READ' : 'V2_WRITE',
      surface: 'agent-instance-route',
      reason: 'Agent instance CRUD is the canonical V2 workflow-instance persistence surface.'
    };
  }

  if (relPath === 'backend/src/routes/runs.routes.ts') {
    return {
      classification: 'V2_READ',
      surface: 'runs-route',
      reason: 'Runs route reads V2 runtime state bound to workflow and agent instance identifiers.'
    };
  }

  if (relPath === 'backend/src/routes/user-workspace.routes.ts') {
    return {
      classification: 'V2_READ',
      surface: 'workspace-hydration-route',
      reason: 'Authoritative authenticated workspace hydration read path.'
    };
  }

  if (relPath === 'backend/src/controllers/workflow.controller.ts') {
    return {
      classification: 'COMPATIBILITY',
      surface: 'workflow-controller',
      reason: 'Controller still projects transitional workflow payload fields while V2 extraction is pending.'
    };
  }

  if (relPath.startsWith('backend/src/application/')) {
    return {
      classification: 'COMPATIBILITY',
      surface: 'application-workflow-usecase',
      reason: 'Application-layer use case still creates or reads workflow payloads that carry transitional canvas metadata.'
    };
  }

  if (relPath === 'backend/src/routes/index.ts' || relPath === 'backend/src/server.ts') {
    return {
      classification: 'COMPATIBILITY',
      surface: 'backend-route-registration',
      reason: 'Route registration exposes workflow instance surfaces without owning workflow persistence semantics.'
    };
  }

  if (relPath === 'backend/src/services/databaseInit.ts') {
    return {
      classification: 'MIGRATION',
      surface: 'database-bootstrap',
      reason: 'Schema/bootstrap compatibility layer still carrying legacy workflow fields.'
    };
  }

  if (relPath.startsWith('backend/scripts/')) {
    return {
      classification: relPath.includes('phase4-tests') ? 'TEST_ONLY' : 'MIGRATION',
      surface: relPath.includes('phase4-tests') ? 'backend-script-test-support' : 'backend-script-maintenance',
      reason: relPath.includes('phase4-tests')
        ? 'Backend helper script used as test support only.'
        : 'Backend maintenance script reading workflow collections during migration or diagnosis.'
    };
  }

  if (relPath === 'backend/src/utils/workspaceSnapshot.ts') {
    return {
      classification: 'COMPATIBILITY',
      surface: 'workspace-snapshot',
      reason: 'Aggregates persisted entities into a transitional workspace DTO.'
    };
  }

  if (relPath === 'backend/src/services/workflowSelfHealing.service.ts') {
    return {
      classification: 'COMPATIBILITY',
      surface: 'workflow-self-healing',
      reason: 'Repair path around workflow hydration and default workflow invariants.'
    };
  }

  if (relPath.startsWith('backend/src/models/') || relPath.startsWith('backend/src/schemas/') || relPath.startsWith('backend/src/types/')) {
    return {
      classification: 'COMPATIBILITY',
      surface: 'backend-schema-model',
      reason: 'Schema/model layer exposing transitional workflow fields or identifiers.'
    };
  }

  if (relPath === 'App.tsx') {
    return {
      classification: 'COMPATIBILITY',
      surface: 'app-hydration-orchestration',
      reason: 'App-level orchestration rehydrates interactive state but must not become the persistence authority.'
    };
  }

  if (relPath === 'types.ts') {
    return {
      classification: 'COMPATIBILITY',
      surface: 'frontend-shared-types',
      reason: 'Shared frontend types still carry transitional workflow shapes.'
    };
  }

  if (relPath === 'services/agentContractAdapters.ts') {
    return {
      classification: 'MIGRATION',
      surface: 'contract-adapter',
      reason: 'Adapts persisted data into the V2 frontend shape during migration.'
    };
  }

  if (relPath === 'services/persistenceService.ts') {
    return {
      classification: /saveWorkflow/.test(lineText) ? 'V2_WRITE' : 'COMPATIBILITY',
      surface: 'frontend-persistence-service',
      reason: 'Dual-mode persistence service spanning authenticated V2 writes and compatibility payload shaping.'
    };
  }

  if (relPath === 'services/workspacePersistenceService.ts') {
    if (/saveEdges|workflowEdges|\/edges/.test(lineText)) {
      return {
        classification: 'V1_WRITE',
        surface: 'workspace-persistence-legacy-edge-write',
        reason: 'Legacy edge persistence still targets the deprecated workflow edges route.'
      };
    }

    return {
      classification: 'COMPATIBILITY',
      surface: 'workspace-persistence-service',
      reason: 'Transitional workspace persistence facade with guest/auth branching.'
    };
  }

  if (relPath.startsWith('services/')) {
    return {
      classification: 'COMPATIBILITY',
      surface: 'frontend-service',
      reason: 'Frontend service still participates in transitional workflow read/write orchestration.'
    };
  }

  if (relPath.startsWith('stores/')) {
    return {
      classification: 'COMPATIBILITY',
      surface: 'frontend-store',
      reason: 'Frontend store contains local transitional workflow state.'
    };
  }

  if (relPath.startsWith('hooks/')) {
    return {
      classification: 'COMPATIBILITY',
      surface: 'frontend-hook',
      reason: 'Frontend hook reconstructs or routes workflow data during the transition.'
    };
  }

  if (relPath.startsWith('components/')) {
    return {
      classification: /saveWorkflow|persistWorkflow/.test(lineText) ? 'V2_WRITE' : 'V2_READ',
      surface: 'frontend-component',
      reason: 'Frontend component reads or triggers canonical workflow UI persistence behavior.'
    };
  }

  if (relPath.startsWith('utils/')) {
    return {
      classification: 'COMPATIBILITY',
      surface: 'frontend-utility',
      reason: 'Utility layer exposes guest-mode or compatibility workflow keys.'
    };
  }

  return {
    classification: 'UNKNOWN',
    surface: 'unclassified',
    reason: 'No classification rule matched this workflow architecture occurrence.'
  };
}

/**
 * @param {string} currentDir
 * @returns {Promise<string[]>}
 */
async function collectFiles(currentDir) {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(absolutePath));
      continue;
    }

    if (!allowedExtensions.has(path.extname(entry.name))) {
      continue;
    }

    files.push(absolutePath);
  }

  return files;
}

/**
 * @param {string} absolutePath
 * @returns {Promise<Array<{ relPath: string, lineNumber: number, lineText: string, token: string, classification: Classification, reason: string, surface: string }>>}
 */
async function scanFile(absolutePath) {
  const relPath = path.relative(repoRoot, absolutePath).replace(/\\/g, '/');
  if (relPath === 'scripts/audit-workflow-architecture.ts') {
    return [];
  }

  const content = await readFile(absolutePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const results = [];

  for (let index = 0; index < lines.length; index += 1) {
    const lineText = lines[index];
    const matches = [...lineText.matchAll(targetPattern)];
    if (matches.length === 0) {
      continue;
    }

    for (const match of matches) {
      const classification = classifyOccurrence(relPath, lineText);
      results.push({
        relPath,
        lineNumber: index + 1,
        lineText: lineText.trim(),
        token: match[0],
        classification: classification.classification,
        reason: classification.reason,
        surface: classification.surface,
      });
    }
  }

  return results;
}

type AuditResult = {
  relPath: string;
  lineNumber: number;
  lineText: string;
  token: string;
  classification: 'V1_READ' | 'V1_WRITE' | 'V2_READ' | 'V2_WRITE' | 'COMPATIBILITY' | 'MIGRATION' | 'TEST_ONLY' | 'UNKNOWN';
  reason: string;
  surface: string;
};

function summarize(results: AuditResult[]) {
  const byClassification = new Map<string, number>();
  const byFile = new Map<string, AuditResult[]>();

  for (const result of results) {
    byClassification.set(result.classification, (byClassification.get(result.classification) || 0) + 1);
    if (!byFile.has(result.relPath)) {
      byFile.set(result.relPath, []);
    }
    byFile.get(result.relPath)?.push(result);
  }

  return { byClassification, byFile };
}

async function main() {
  const files = await collectFiles(repoRoot);
  const occurrences: AuditResult[] = [];

  for (const filePath of files) {
    occurrences.push(...await scanFile(filePath));
  }

  const unknownOccurrences = occurrences.filter((entry) => entry.classification === 'UNKNOWN');
  const legacyWrites = occurrences.filter((entry) => entry.classification === 'V1_WRITE');
  const strictViolations = strictMode
    ? legacyWrites.filter((entry) => !protectedLegacyWriteFiles.has(entry.relPath))
    : [];

  const { byClassification, byFile } = summarize(occurrences);

  console.log('# Workflow architecture audit');
  console.log(`mode=${strictMode ? 'strict' : 'standard'}`);
  console.log(`occurrences=${occurrences.length}`);
  console.log('');
  console.log('## Counts by classification');
  for (const classification of ['V1_READ', 'V1_WRITE', 'V2_READ', 'V2_WRITE', 'COMPATIBILITY', 'MIGRATION', 'TEST_ONLY', 'UNKNOWN']) {
    console.log(`- ${classification}: ${byClassification.get(classification) || 0}`);
  }

  console.log('');
  console.log('## Inventory');
  for (const [relPath, entries] of [...byFile.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
    const first = entries[0];
    const lineNumbers = [...new Set(entries.map((entry) => Number(entry.lineNumber)))].sort((a, b) => a - b).join(', ');
    const tokens = [...new Set(entries.map((entry) => entry.token))].join(', ');
    console.log(`- ${relPath}`);
    console.log(`  classification=${first.classification}; lines=${lineNumbers}; tokens=${tokens}; surface=${first.surface}`);
    console.log(`  reason=${first.reason}`);
  }

  if (unknownOccurrences.length > 0) {
    console.error('');
    console.error('## UNKNOWN occurrences');
    for (const entry of unknownOccurrences) {
      console.error(`- ${entry.relPath}:${entry.lineNumber} :: ${entry.token} :: ${entry.lineText}`);
    }
  }

  if (strictViolations.length > 0) {
    console.error('');
    console.error('## Strict violations');
    for (const entry of strictViolations) {
      console.error(`- ${entry.relPath}:${entry.lineNumber} :: ${entry.token} :: ${entry.lineText}`);
    }
  }

  if (unknownOccurrences.length > 0 || strictViolations.length > 0) {
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log('Audit result: OK');
}

main().catch((error) => {
  console.error('Workflow architecture audit failed.');
  console.error(error);
  process.exitCode = 1;
});