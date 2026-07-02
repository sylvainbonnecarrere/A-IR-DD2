import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const backendRoot = path.join(repoRoot, 'backend');
const expectedVersion = '25.9.0';
const expectedEngineRange = '>=25.9.0 <26';
const backendSliceArgs = [
  'src/__tests__/runtimeWrappers.test.ts',
  'src/__tests__/execution-orchestrator.test.ts',
  'src/__tests__/legacy-tools-coexistence.test.ts',
  '--runInBand',
];

function fail(message) {
  throw new Error(`[ci:node25:runtime] ${message}`);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function readText(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  assert(existsSync(absolutePath), `Missing file: ${relativePath}`);
  return readFileSync(absolutePath, 'utf8').trim();
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function runNodeScript(cwd, scriptPath, args = []) {
  const absoluteScriptPath = path.join(cwd, scriptPath);
  assert(existsSync(absoluteScriptPath), `Missing script: ${path.relative(repoRoot, absoluteScriptPath)}`);

  execFileSync(process.execPath, [absoluteScriptPath, ...args], {
    cwd,
    stdio: 'inherit',
  });
}

function verifyAnchors() {
  const rootPackage = readJson('package.json');
  const backendPackage = readJson('backend/package.json');

  assert(process.version === `v${expectedVersion}`, `Expected Node v${expectedVersion}, received ${process.version}.`);
  assert(readText('.nvmrc') === expectedVersion, `.nvmrc must stay pinned to ${expectedVersion}.`);
  assert(readText('.node-version') === expectedVersion, `.node-version must stay pinned to ${expectedVersion}.`);
  assert(rootPackage.engines?.node === expectedEngineRange, `package.json engines.node must be ${expectedEngineRange}.`);
  assert(backendPackage.engines?.node === expectedEngineRange, `backend/package.json engines.node must be ${expectedEngineRange}.`);
}

function main() {
  console.log('[ci:node25:runtime] verifying Node 25 anchors');
  verifyAnchors();

  console.log('[ci:node25:runtime] running readiness report');
  runNodeScript(repoRoot, 'scripts/prepare-node25-validation.mjs', [expectedVersion]);

  console.log('[ci:node25:runtime] running backend workspace and sandbox verification slice');
  runNodeScript(backendRoot, 'node_modules/jest/bin/jest.js', backendSliceArgs);

  console.log('[ci:node25:runtime] Node 25 runtime verification succeeded');
}

main();