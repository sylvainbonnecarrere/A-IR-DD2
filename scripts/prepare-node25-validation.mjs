import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const targetVersion = process.argv[2] || '25.9.0';

function readTrimmedFile(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!existsSync(absolutePath)) {
    return null;
  }

  return readFileSync(absolutePath, 'utf8').trim() || null;
}

function readPackageEngines() {
  const packageJsonPath = path.join(repoRoot, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return null;
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  return packageJson.engines?.node ?? null;
}

function findCommand(command) {
  const locator = process.platform === 'win32' ? 'where' : 'which';

  try {
    const result = execFileSync(locator, [command], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    return result.split(/\r?\n/)[0] || null;
  } catch {
    return null;
  }
}

function buildManagers(version) {
  return [
    {
      name: 'nvm',
      path: findCommand('nvm'),
      installCommand: `nvm install ${version}`,
      useCommand: `nvm use ${version}`,
      note: 'Compatible avec nvm-windows.',
    },
    {
      name: 'fnm',
      path: findCommand('fnm'),
      installCommand: `fnm install ${version}`,
      useCommand: `fnm use ${version}`,
      note: 'Rapide et simple pour un shell par projet.',
    },
    {
      name: 'volta',
      path: findCommand('volta'),
      installCommand: `volta install node@${version}`,
      useCommand: `volta run node@${version} node -v`,
      note: 'Volta permet une bascule ponctuelle sans toucher aux fichiers de version du repo.',
    },
    {
      name: 'nvs',
      path: findCommand('nvs'),
      installCommand: `nvs add ${version}`,
      useCommand: `nvs use ${version}`,
      note: 'Option utile si nvs est deja standardise sur le poste.',
    },
  ];
}

function printSection(title) {
  console.log(`\n${title}`);
}

const pinnedNvmVersion = readTrimmedFile('.nvmrc');
const pinnedNodeVersion = readTrimmedFile('.node-version');
const engineRange = readPackageEngines();
const installedManagers = buildManagers(targetVersion).filter((manager) => manager.path);

console.log('Node 25 readiness check');
console.log('================================');
console.log(`Current runtime        : ${process.version}`);
console.log(`Pinned .nvmrc          : ${pinnedNvmVersion ?? 'missing'}`);
console.log(`Pinned .node-version   : ${pinnedNodeVersion ?? 'missing'}`);
console.log(`package.json engines   : ${engineRange ?? 'missing'}`);
console.log(`Target validation line : ${targetVersion}`);

printSection('Recommended workflow');
console.log('1. Open a dedicated Node 25 shell before installing dependencies or starting the app.');
console.log('2. Reinstall dependencies in that shell when switching from a previous major Node line.');
console.log('3. Validate the backend workspace and sandbox test slice before broader manual QA.');
console.log('4. Run the guest and authenticated startup scenarios after the focused verification slice passes.');

if (installedManagers.length === 0) {
  printSection('No version manager detected');
  console.log('Install one of the following before the Node 25 manual pass:');
  console.log('- nvm-windows: https://github.com/coreybutler/nvm-windows');
  console.log('- Volta: https://volta.sh');
  console.log('- fnm: https://github.com/Schniz/fnm');
} else {
  printSection('Detected version managers');
  for (const manager of installedManagers) {
    console.log(`- ${manager.name}: ${manager.path}`);
    console.log(`  install : ${manager.installCommand}`);
    console.log(`  use     : ${manager.useCommand}`);
    console.log(`  note    : ${manager.note}`);
  }
}

printSection('Suggested manual validation commands');
console.log('- node -v');
console.log('- npm install');
console.log('- cd backend ; npm install');
console.log('- cd backend ; npx jest src/__tests__/runtimeWrappers.test.ts src/__tests__/execution-orchestrator.test.ts src/__tests__/legacy-tools-coexistence.test.ts --runInBand');
console.log('- cd backend ; npm run dev');
console.log('- npm run dev');
console.log('- Execute the guest cold start scenario, then the authenticated cold start scenario.');