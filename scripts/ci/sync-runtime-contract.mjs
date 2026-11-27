#!/usr/bin/env node
/**
 * sync-runtime-contract — US-RC-10 : génère le type front des événements runtime
 * à partir du contrat Zod backend, source de vérité unique.
 *
 * Pourquoi : `backend/src/domain/execution/runtimeEvent.contract.ts` (Zod, `.strict()`)
 * est le seul contrat ; le front ne peut pas l'importer (le `rootDir: "."` de
 * backend/tsconfig.json interdit toute importation hors de backend/, et le front
 * n'importe jamais depuis backend/src). Aucun monorepo `packages/contracts` non plus.
 *
 * Mécanisme : ce script lit le contrat source et en extrait les valeurs **par AST**
 * (package `typescript`, aucune regex sur le texte, aucune dépendance zod/tsx ajoutée) :
 * - `RUNTIME_EVENT_TYPE_VALUES` (tableau `as const` alimentant `z.enum(...)`)
 * - `RUNTIME_EVENT_AGGREGATE_VALUES`
 * - `RUNTIME_EVENT_ALLOWED_PAYLOAD_KEYS` (`new Set([...])`)
 * puis émet `types/runtimeEvent.generated.ts`, 100 % type-only, mis en forme avec
 * prettier (config racine .prettierrc.json) pour rester vert au gate `format:changed`.
 *
 * Usage :
 *   node scripts/ci/sync-runtime-contract.mjs                # régénère le fichier
 *   node scripts/ci/sync-runtime-contract.mjs --check        # exit 1 si drift (CI)
 *   node scripts/ci/sync-runtime-contract.mjs --self-test    # vérifie --check en mémoire
 *
 * Le fichier généré porte en en-tête le sha256 du contrat source ; `--check` compare
 * le contenu régénéré (hash inclus) au fichier présent — toute divergence bloque.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const prettier = require('prettier');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONTRACT_PATH = path.join(root, 'backend', 'src', 'domain', 'execution', 'runtimeEvent.contract.ts');
const GENERATED_PATH = path.join(root, 'types', 'runtimeEvent.generated.ts');
const CONTRACT_REL = 'backend/src/domain/execution/runtimeEvent.contract.ts';
const GENERATED_REL = 'types/runtimeEvent.generated.ts';

// US-J7-09 : types de quarantaine/fencing que le contrat doit contenir (16 littéraux au total).
const REQUIRED_QUARANTINE_TYPES = ['run:quarantined', 'run:fenced', 'run:recovery_relaunched'];

function stringLiteralsOf(arrayLiteral) {
  const values = [];
  for (const element of arrayLiteral.elements) {
    if (ts.isStringLiteral(element) || ts.isNoSubstitutionTemplateLiteral(element)) {
      values.push(element.text);
    } else {
      throw new Error(`sync-runtime-contract: élément non littéral dans un tableau de valeurs du contrat (${ts.SyntaxKind[element.kind]})`);
    }
  }
  return values;
}

function extractConstArray(sourceFile, varName) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== varName) continue;
      let initializer = declaration.initializer;
      if (!initializer) throw new Error(`sync-runtime-contract: ${varName} sans initialiseur`);
      // `[...] as const`
      if (ts.isAsExpression(initializer)) initializer = initializer.expression;
      if (!ts.isArrayLiteralExpression(initializer)) {
        throw new Error(`sync-runtime-contract: ${varName} n'est pas un tableau littéral`);
      }
      return stringLiteralsOf(initializer);
    }
  }
  throw new Error(`sync-runtime-contract: constante ${varName} introuvable dans ${CONTRACT_REL}`);
}

function extractSetValues(sourceFile, varName) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== varName) continue;
      const initializer = declaration.initializer;
      if (!initializer || !ts.isNewExpression(initializer) || !ts.isArrayLiteralExpression(initializer.arguments?.[0])) {
        throw new Error(`sync-runtime-contract: ${varName} n'est pas un new Set([...])`);
      }
      return stringLiteralsOf(initializer.arguments[0]);
    }
  }
  throw new Error(`sync-runtime-contract: constante ${varName} introuvable dans ${CONTRACT_REL}`);
}

function unionType(name, values) {
  if (values.length === 1) return `export type ${name} = '${values[0]}';\n`;
  // Style multi-lignes compatible prettier (printWidth 140) : un membre par ligne.
  return `export type ${name} =\n${values.map((v) => `  | '${v}'`).join('\n')};\n`;
}

async function buildGenerated(contractSource) {
  const hash = createHash('sha256').update(contractSource).digest('hex');
  const sourceFile = ts.createSourceFile(CONTRACT_REL, contractSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const eventTypes = extractConstArray(sourceFile, 'RUNTIME_EVENT_TYPE_VALUES');
  const aggregateTypes = extractConstArray(sourceFile, 'RUNTIME_EVENT_AGGREGATE_VALUES');
  const payloadKeys = extractSetValues(sourceFile, 'RUNTIME_EVENT_ALLOWED_PAYLOAD_KEYS');

  for (const required of REQUIRED_QUARANTINE_TYPES) {
    if (!eventTypes.includes(required)) {
      throw new Error(`sync-runtime-contract: le contrat ne contient pas le type de quarantaine requis '${required}'`);
    }
  }

  const raw = `// @generated by scripts/ci/sync-runtime-contract.mjs — ne pas éditer à la main
// source: ${CONTRACT_REL} sha256:${hash}
// Régénérer après toute évolution du contrat backend : npm run contract:sync
// Parité vérifiée en CI (hygiene-gate) : npm run contract:check

${unionType('RuntimeEventType', eventTypes)}
${unionType('RuntimeEventAggregateType', aggregateTypes)}
${unionType('RuntimeEventPayloadKey', payloadKeys)}
// Miroir type-only du contrat Zod .strict() (backend) — aucun import zod côté front.
export interface RuntimeEventEnvelope {
  id: string;
  type: RuntimeEventType;
  version: 1;
  aggregateType: RuntimeEventAggregateType;
  aggregateId: string;
  workspaceId: string;
  correlationId?: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}
`;
  const prettierConfig = JSON.parse(readFileSync(path.join(root, '.prettierrc.json'), 'utf8'));
  return await prettier.format(raw, { ...prettierConfig, parser: 'babel-ts' });
}

async function runCheck() {
  const contractSource = readFileSync(CONTRACT_PATH, 'utf8');
  const expected = await buildGenerated(contractSource);
  if (!existsSync(GENERATED_PATH)) {
    console.error(`[contract] ${GENERATED_REL} absent — lancer npm run contract:sync`);
    return false;
  }
  const current = readFileSync(GENERATED_PATH, 'utf8');
  if (current !== expected) {
    const expectedHash = /sha256:([0-9a-f]{64})/.exec(expected)?.[1];
    const currentHash = /sha256:([0-9a-f]{64})/.exec(current)?.[1];
    console.error(
      `[contract] DRIFT détecté sur ${GENERATED_REL}: sha256 contrat attendu ${expectedHash}, en-tête fichier ${currentHash ?? 'absent'}`,
    );
    console.error(
      '[contract] Corriger : modifier le contrat backend (PR 03-backend) puis `npm run contract:sync`, ou régénérer depuis le contrat courant.',
    );
    return false;
  }
  console.log(`[contract] parité OK — ${GENERATED_REL} à jour (sha256 contrat ${/sha256:([0-9a-f]{64})/.exec(expected)[1].slice(0, 12)}…)`);
  return true;
}

async function runSelfTest() {
  const contractSource = readFileSync(CONTRACT_PATH, 'utf8');
  const expected = await buildGenerated(contractSource);
  const assert = (cond, message) => {
    if (!cond) throw new Error(`self-test failed: ${message}`);
  };
  try {
    // 1. Le contrat couvre bien les 3 types de quarantaine US-J7-09 et 16 littéraux.
    for (const required of REQUIRED_QUARANTINE_TYPES) {
      assert(expected.includes(`'${required}'`), `le type généré doit contenir '${required}'`);
    }
    assert((expected.match(/\|/g) || []).length >= 16, 'le type RuntimeEventType doit contenir au moins 16 littéraux');
    // 2. Arbre propre : le fichier présent correspond au contrat courant.
    assert(existsSync(GENERATED_PATH), `${GENERATED_REL} doit exister (lancer npm run contract:sync)`);
    assert(readFileSync(GENERATED_PATH, 'utf8') === expected, '--check doit passer sur un arbre propre');
    // 3. Simulation en mémoire : fichier généré altéré -> --check échoue (aucun fichier touché).
    const tampered = expected.replace("'run:queued'", "'run:removed'");
    assert(tampered !== expected && tampered !== readFileSync(GENERATED_PATH, 'utf8'), '--check doit détecter un contenu généré altéré');
    // 4. Simulation en mémoire : contrat source modifié -> le hash change et le contenu régénéré diverge.
    const drifted = buildGenerated(contractSource + '\n// simulation drift\n');
    assert(drifted !== expected, '--check doit détecter un contrat source modifié (hash sha256 en en-tête)');
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  console.log('[contract] self-test OK (parité hash + contenu, détection de drift en mémoire, aucun fichier touché)');
  process.exit(0);
}

const mode = process.argv[2];
if (mode === '--self-test') {
  await runSelfTest();
} else if (mode === '--check') {
  process.exit((await runCheck()) ? 0 : 1);
} else {
  const contractSource = readFileSync(CONTRACT_PATH, 'utf8');
  const generated = await buildGenerated(contractSource);
  writeFileSync(GENERATED_PATH, generated);
  console.log(
    `[contract] ${GENERATED_REL} régénéré depuis ${CONTRACT_REL} (sha256 ${createHash('sha256').update(contractSource).digest('hex').slice(0, 12)}…)`,
  );
}
