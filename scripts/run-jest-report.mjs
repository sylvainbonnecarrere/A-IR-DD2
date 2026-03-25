import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Usage: node scripts/run-jest-report.mjs <testPath> --outputDir <dir> --reportBase <name>');
  process.exit(1);
}

const testPath = args[0];

const getOption = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};

const outputDir = getOption('--outputDir', 'tests/temp_rapport_tests');
const reportBase = getOption('--reportBase', 'jest-report');
const resolvedOutputDir = path.resolve(process.cwd(), outputDir);

await mkdir(resolvedOutputDir, { recursive: true });

const jestCommand = ['npx', 'jest', testPath, '--runInBand', '--verbose'];
const spawnCommand = process.platform === 'win32' ? 'cmd.exe' : jestCommand[0];
const spawnArgs = process.platform === 'win32'
  ? ['/d', '/s', '/c', jestCommand.join(' ')]
  : jestCommand.slice(1);

const child = spawn(spawnCommand, spawnArgs, {
  cwd: process.cwd(),
  env: process.env,
  stdio: ['inherit', 'pipe', 'pipe'],
});

let output = '';

child.stdout.on('data', (chunk) => {
  const text = chunk.toString();
  output += text;
  process.stdout.write(text);
});

child.stderr.on('data', (chunk) => {
  const text = chunk.toString();
  output += text;
  process.stderr.write(text);
});

const exitCode = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('close', resolve);
});

await writeFile(path.join(resolvedOutputDir, `${reportBase}.out`), output, 'utf8');
await writeFile(path.join(resolvedOutputDir, `${reportBase}.exit`), `${exitCode ?? 1}\n`, 'utf8');

process.exit(exitCode ?? 1);