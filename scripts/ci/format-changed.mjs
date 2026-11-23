#!/usr/bin/env node
/**
 * `format:changed` (R4, US-RC-00b) — bloquant : exit != 0 si un fichier modifié
 * par rapport à la base n'est pas formaté (prettier --check).
 *
 * Base utilisée : `origin/$GITHUB_BASE_REF...HEAD` (en CI, le job US-RC-01 positionne
 * `GITHUB_BASE_REF` via `${{ github.base_ref || 'main' }}` et checkout avec
 * `fetch-depth: 0` — Without historique complet, `origin/<base>` n'existe pas et le
 * diff serait vide donc faussement vert) ; fallback local `main...HEAD` conservé.
 * Diff vide -> exit 0. Plus de `|| true` : un fichier non formaté fait échouer.
 *
 * Helper node (et non une formule shell dans package.json) pour fonctionner à
 * l'identique sur sh (CI ubuntu) et cmd.exe (Windows).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const prettierBin = require.resolve('prettier/bin/prettier.cjs');

const baseRef = process.env.GITHUB_BASE_REF?.trim() || 'main';

function diffNames(range) {
  try {
    return execFileSync('git', ['diff', '--name-only', '--diff-filter=ACM', range], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    return null; // ref inconnue (ex. origin/main absent en local) -> on essaie le fallback
  }
}

const changed = diffNames(`origin/${baseRef}...HEAD`) ?? diffNames('main...HEAD') ?? [];

if (changed.length === 0) {
  console.log(`[format:changed] aucun fichier modifié vs origin/${baseRef}...HEAD (fallback main...HEAD) — OK`);
  process.exit(0);
}

console.log(`[format:changed] ${changed.length} fichier(s) modifié(s) vs base, prettier --check :`);
const result = spawnSync(process.execPath, [prettierBin, '--check', ...changed, '--ignore-unknown'], { cwd: root, stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
