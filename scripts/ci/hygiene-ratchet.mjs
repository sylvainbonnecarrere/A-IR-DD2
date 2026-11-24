#!/usr/bin/env node
// ⭐ Ratchet d'hygiène (2026-11-21, étendu US-RC-07) : bloque toute AUGMENTATION
// - du nombre de `any` explicites et de `console.log(` dans le code versionné
//   (frontend racine + backend/src) ;
// - du nombre de WARNINGS eslint (severity 1) du repo, répartis en
//   lintWarningsFrontend / lintWarningsBackend (un seul run eslint JSON, mis en cache
//   dans node_modules/.cache — ~20 s au premier run, rapide ensuite).
// La dette existante est connue et listée dans hygiene-baseline.json ; on ne fait que
// empêcher qu'elle grossisse. Pour corriger la dette : diminuer les compteurs, puis
// `npm run hygiene:update-baseline`.
//
// Usage :
//   node scripts/ci/hygiene-ratchet.mjs            -> vérifie (exit 1 si régression)
//   node scripts/ci/hygiene-ratchet.mjs --update   -> recale la baseline sur l'actuel
//   node scripts/ci/hygiene-ratchet.mjs --self-test -> vérifie que les fichiers NON SUIVIS
//     sont bien pris en compte (R2) : crée un fichier temporaire non suivi avec `as any`
//     puis `console.log(`, attend exit 1 à chaque fois, nettoie, attend exit 0.
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const baselinePath = path.join(root, 'scripts', 'ci', 'hygiene-baseline.json');

const ANY_RE = /(:\s*any\b|as\s+any\b|<any>|any\[\]|Promise<any>)/g;
const LOG_RE = /console\.log\(/g;

// R2 : --cached --others --exclude-standard = fichiers suivis + fichiers non suivis
// (non ignorés), donc un nouveau fichier non commité est compté dès le run local.
const listFiles = (pattern) =>
  execSync(`git ls-files --cached --others --exclude-standard ${pattern}`, { cwd: root, encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean);

const SELF_TEST_FILE = path.join(root, 'ratchet-selftest.tmp.ts');

function runSelfTest() {
  const self = fileURLToPath(import.meta.url);
  const run = () => spawnSync(process.execPath, [self], { cwd: root, encoding: 'utf8' });
  const assert = (cond, message) => {
    if (!cond) throw new Error(`self-test failed: ${message}`);
  };
  try {
    fs.writeFileSync(SELF_TEST_FILE, 'export const dirty = 1 as any;\n');
    const withAny = run();
    assert(withAny.status === 1, 'le ratchet doit échouer (exit 1) sur un fichier NON SUIVI contenant as any');
    fs.writeFileSync(SELF_TEST_FILE, 'console.log("dirty");\n');
    const withLog = run();
    assert(withLog.status === 1, 'le ratchet doit échouer (exit 1) sur un fichier NON SUIVI contenant console.log(');
    // US-RC-07 : sonde warnings eslint — une variable inutilisée dans un fichier non
    // suivi ne touche ni ANY_RE ni LOG_RE, seul le compteur de warnings doit capter.
    fs.writeFileSync(SELF_TEST_FILE, 'const ratchetUnusedProbe = 1;\nexport {};\n');
    const withWarn = run();
    assert(
      withWarn.status === 1,
      'le ratchet doit échouer (exit 1) sur un fichier NON SUIVI produisant un warning eslint (variable inutilisée)',
    );
  } finally {
    fs.rmSync(SELF_TEST_FILE, { force: true });
  }
  const clean = run();
  assert(clean.status === 0, 'le ratchet doit repasser vert (exit 0) après nettoyage du fichier temporaire');
  console.log('[hygiene-ratchet] self-test OK (fichiers non suivis --others pris en compte)');
  process.exit(0);
}

if (process.argv.includes('--self-test')) runSelfTest();

const frontendFiles = listFiles('"*.ts" "*.tsx"').filter((f) => !f.startsWith('backend/') && !f.includes('node_modules'));
const backendFiles = listFiles('"backend/src/*.ts"');

const countIn = (files, re) =>
  files.reduce((n, f) => {
    try {
      return n + (fs.readFileSync(path.join(root, f), 'utf8').match(re) || []).length;
    } catch {
      return n;
    }
  }, 0);

// US-RC-07 : compteurs de warnings eslint (severity 1) — un seul run eslint du repo,
// résultat JSON parsé, réparti frontend (hors backend/) / backend (sous backend/).
// Le cache eslint (node_modules/.cache, hors git) rend les runs suivants quasi
// instantanés ; les fichiers non suivis sont lintés aussi (eslint . les voit).
const countLintWarnings = () => {
  const eslintBin = path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js');
  const res = spawnSync(
    process.execPath,
    [eslintBin, '.', '--format', 'json', '--cache', '--cache-location', path.join('node_modules', '.cache', 'hygiene-ratchet-eslint.json')],
    { cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 },
  );
  let report;
  try {
    report = JSON.parse(res.stdout);
  } catch {
    throw new Error(`ratchet: sortie eslint illisible (status ${res.status}) — run hors cache ?`);
  }
  let frontend = 0;
  let backend = 0;
  for (const f of report) {
    const rel = path.relative(root, f.filePath).split(path.sep).join('/');
    const warnings = f.messages.filter((m) => m.severity === 1).length;
    if (rel.startsWith('backend/')) backend += warnings;
    else frontend += warnings;
  }
  return { lintWarningsFrontend: frontend, lintWarningsBackend: backend };
};

const current = {
  anyFrontend: countIn(frontendFiles, ANY_RE),
  anyBackend: countIn(backendFiles, ANY_RE),
  consoleLogFrontend: countIn(frontendFiles, LOG_RE),
  consoleLogBackend: countIn(backendFiles, LOG_RE),
  ...countLintWarnings(),
};

if (process.argv.includes('--update')) {
  fs.writeFileSync(
    baselinePath,
    JSON.stringify(
      { note: 'Baseline ratchet hygiène — ne recale que quand la dette DIMINUE.', updatedAt: new Date().toISOString(), ...current },
      null,
      2,
    ) + '\n',
  );
  console.log('Baseline recalée :', JSON.stringify(current));
  process.exit(0);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const keys = Object.keys(current);
let regressed = false;

console.log('Hygiene ratchet (baseline -> actuel) :');
for (const k of keys) {
  const before = baseline[k] ?? 0;
  const after = current[k];
  const status = after > before ? 'REGRESSION' : after < before ? 'amelioration' : 'stable';
  if (after > before) regressed = true;
  console.log(`  ${k}: ${before} -> ${after}  [${status}]`);
}

if (regressed) {
  console.error(
    '\nECHEC ratchet : la dette (any / console.log / warnings eslint) a AUGMENTE — corrige ou justifie, ne recale pas la baseline.',
  );
  process.exit(1);
}
console.log('\nOK : aucune augmentation de la dette hygiène.');
